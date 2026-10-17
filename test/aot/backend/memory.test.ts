import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

const python = Bun.which("python3");

function fault(time: number, page: number, frames: string[]) {
  const head = `server 7/7 ${time.toFixed(6)}: exceptions:page_fault_user: address=0x${(page * 4096 + 8).toString(16)} ip=0x400100 error_code=0x6\n`;
  return head + frames.map(frame => `\t          400100 ${frame}+0x4 (/work/server)\n`).join("") + "\n";
}

test.skipIf(!python)("measure/memory_kinds.py gives a page to the nearest frame of the last fault on it", () => {
  using dir = tempDir("aot-backend-memory-kinds", {
    "time": "100.5",
    "pages": "1000000 1004000 rw-p \naaa.\n2000000 2001000 rw-p [stack]\na\n3000000 3002000 r--p /work/server\nff\n",
  });
  const faults =
    fault(100.1, 0x1000, [
      "mi_page_extend_free",
      "WTF::StringImpl::createUninitialized",
      "bun_sql::postgres::on_data",
    ]) +
    fault(100.2, 0x1001, ["memset", "bun_sql::postgres::DataCell::from_bytes"]) +
    fault(100.3, 0x1001, ["JSC::JSRopeString::resolveRope", "bun_sql::postgres::on_data"]) +
    fault(100.9, 0x1001, ["uWS::HttpResponse::write"]) +
    fault(100.4, 0x2000, ["main"]);
  writeFileSync(join(String(dir), "faults.txt.gz"), Bun.gzipSync(Buffer.from(faults)));
  const run = Bun.spawnSync(
    [python!, join(import.meta.dir, "measure", "memory_kinds.py"), "table", `server=${String(dir)}`],
    { cwd: String(dir) },
  );
  expect(run.stderr.toString()).toBe("");
  const lines = run.stdout.toString().split(/\r?\n/);
  expect(lines).toContain("| **all** | **0.0** |");
  const counts = Bun.spawnSync(
    [
      python!,
      "-c",
      `import collections, json, sys\nsys.path.insert(0, ${JSON.stringify(join(import.meta.dir, "measure"))})\nimport memory_kinds\nprint(json.dumps(memory_kinds.count_pages(".", "server", collections.Counter())))`,
    ],
    { cwd: String(dir) },
  );
  expect(counts.stderr.toString()).toBe("");
  expect(JSON.parse(counts.stdout.toString())).toEqual({
    "heap and malloc": { "strings: other": 1, "strings: ropes flattened": 1, "(no fault seen)": 1 },
    "stacks": { "": 1 },
  });
});

test.skipIf(!python)("measure/memory_table.py prints what memory.py measured", () => {
  const totals = (rss: number) => ({
    Rss: rss,
    Pss: rss,
    RssAnon: rss / 2,
    RssFile: rss / 2,
    RssShmem: 0,
    Private_Dirty: rss / 2,
    Anonymous: rss / 2,
    LazyFree: 0,
  });
  const row = (column: string, rss: number) =>
    JSON.stringify({
      column,
      ...Object.fromEntries(
        ["ready", "load_median", "load_highest", "after10", "after40"].map(reading => [reading, totals(rss)]),
      ),
      ...Object.fromEntries(
        ["ready_mappings", "load_mappings", "after40_mappings"].map(reading => [
          reading,
          { "executable: code": [rss / 2, 0, 0] },
        ]),
      ),
    });
  using dir = tempDir("aot-backend-memory-table", {
    "rows.jsonl": row("aot", 10240) + "\n" + row("jit", 20480) + "\n",
  });
  const run = Bun.spawnSync([python!, join(import.meta.dir, "measure", "memory_table.py"), "rows.jsonl"], {
    cwd: String(dir),
  });
  expect(run.stderr.toString()).toBe("");
  expect(run.stdout.toString()).toContain("| under the mix, median: RSS | 10.0 | 20.0 | -10.0 (-50%) |  |");
  expect(run.stdout.toString()).toContain("| executable: code | 5.0 (0.0) | 10.0 (0.0) |");
});
