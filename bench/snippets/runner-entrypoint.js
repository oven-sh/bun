// note: this isn't done yet
// we look for `// @runtime` in the file to determine which runtimes to run the benchmark in
import { spawnSync } from "bun";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { basename, extname } from "path";

const exts = [".js", ".ts", ".mjs", ".tsx"];

const runtimes = {
  bun: process.execPath,
  node: process.env.NODE ?? Bun.which("node"),
  deno: process.env.DENO ?? Bun.which("deno"),
};

if (process.env.BUN_ONLY) {
  delete runtimes.node;
  delete runtimes.deno;
}

function getEntry(sourceContents, file) {
  const targetLineStart = sourceContents.indexOf("// @runtime ");
  if (targetLineStart === -1) {
    return;
  }

  const targetLineEnd = sourceContents.indexOf("\n", targetLineStart);
  if (targetLineEnd === -1) {
    return;
  }

  const targetLine = sourceContents.slice(targetLineStart, targetLineEnd);
  const targets = targetLine
    .slice("// @runtime ".length)
    .split(/[,\s]+/gm)
    .map(a => a.trim().toLowerCase())
    .filter(Boolean)
    .sort();

  if (targets.length === 0) {
    throw new TypeError("No targets specified in " + JSON.stringify(file) + "\n> " + JSON.stringify(targetLine) + "\n");
  }

  var cmds = {};
  for (let target of targets) {
    if (!(target in runtimes)) {
      throw new TypeError(
        "Unknown target " + JSON.stringify(target) + "\n> " + targetLine + "\n file:" + JSON.stringify(file),
      );
    }

    switch (target) {
      case "bun": {
        if (!runtimes.bun) {
          continue;
        }

        cmds.bun = [runtimes.bun, "run", file];
        break;
      }

      case "node": {
        if (!runtimes.node) {
          continue;
        }
        cmds.node = [runtimes.node, file];
        break;
      }

      case "deno": {
        if (!runtimes.deno) {
          continue;
        }
        cmds.deno = [runtimes.deno, "run", "-A", "--unstable", file];
        break;
      }

      default: {
        throw new Error("This should not be reached.");
        break;
      }
    }
  }

  if (Object.keys(cmds).length === 0) {
    return;
  }

  return cmds;
}

function scan() {
  const queue = [];
  for (let file of readdirSync(import.meta.dir)) {
    if (!exts.includes(extname(file))) continue;
    if (file.includes("runner")) continue;

    const cmds = getEntry(readFileSync(file, "utf8"), file);
    if (!cmds) continue;

    queue.push({ file, cmds });
  }

  return queue;
}

const env = {
  ...process.env,
  BENCHMARK_RUNNER: "1",
  NODE_NO_WARNINGS: "1",
  NODE_OPTIONS: "--no-warnings",
  BUN_DEBUG_QUIET_LOGS: "1",
  NO_COLOR: "1",
  DISABLE_COLORS: "1",
};

function* run({ cmds, file }) {
  const benchmarkID = basename(file)
    .toLowerCase()
    .replace(/\.m?js$/, "")
    .replace(/\.tsx?$/, "")
    .replace(".node", "")
    .replace(".deno", "")
    .replace(".bun", "");

  // if benchmarkID doesn't contain only words, letters or numbers or dashes or underscore, throw
  if (!/^[a-z0-9_-]+$/i.test(benchmarkID)) {
    throw new Error(
      "Benchmark files must only contain /a-zA-Z0-9-_/ " +
        JSON.stringify(benchmarkID) +
        " in file " +
        JSON.stringify(file),
    );
  }

  for (let runtime in cmds) {
    const timestamp = Date.now();
    const spawnStart = performance.now();
    var { stdout, exitCode } = spawnSync({
      cmd: cmds[runtime],
      env,
      stderr: "inherit",
      stdout: "pipe",
    });
    const spawnElapsed = performance.now() - spawnStart;
    stdout = stdout.toString();
    try {
      const json = JSON.parse(stdout.trim());
      yield {
        file: file,
        benchmarkID,
        result: json,
        runtime: runtime,
        timestamp,
        elapsed: spawnElapsed,
        runtimeVersion: (runtime === "bun"
          ? `${Bun.version}-${Bun.revision}`
          : String(json?.runtime).split(" ").at(1)
        ).replace(/^v/, ""),
      };
    } catch (e) {
      console.error("Failing file", file);
      console.error(JSON.stringify(cmds[runtime]));
      console.error(stdout.toString());
      throw e;
    }

    if (exitCode !== 0) {
      throw new Error("Non-zero exit code in file " + JSON.stringify(file) + ", runtime: " + JSON.stringify(runtime));
    }
  }
}

const db = Database.open(process.RUNNER_DB_PATH ?? `runs-${process.platform}-${process.arch}.db`);
db.run(`CREATE TABLE IF NOT EXISTS benchmarkResults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    results TEXT NOT NULL
);`);
db.run(`
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    runtime TEXT NOT NULL,
    runtimeVersion TEXT NOT NULL,
    benchmarkID TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    elapsed REAL NOT NULL,
    benchmarkResultID INTEGER NOT NULL
);


`);
db.run(`CREATE INDEX IF NOT EXISTS runs_benchmarkID ON runs (benchmarkID);`);
db.run(`CREATE INDEX IF NOT EXISTS runs_timestamp ON runs (timestamp);`);
db.run(`CREATE INDEX IF NOT EXISTS runs_runtime ON runs (runtime);`);
db.run(`CREATE INDEX IF NOT EXISTS runs_runtimeVersion ON runs (runtimeVersion);`);
db.run(`CREATE INDEX IF NOT EXISTS runs_benchmarkResultID ON runs (benchmarkResultID);`);

// TODO: finish this
for (let result of scan()) {
  var prevBenchmarkID = null;
  for (let {
    runtime,
    benchmarkID,
    runtimeVersion,
    timestamp,
    elapsed,
    file,
    result: { benchmarks },
  } of run(result)) {
    if (prevBenchmarkID !== benchmarkID) {
      console.log("\n" + `${benchmarkID}:`);
      prevBenchmarkID = benchmarkID;
    }

    console.log(
      " ",
      `[${Math.round(elapsed)}ms]`,
      "Executed",
      JSON.stringify(benchmarkID),
      "in",
      runtime,
      runtimeVersion,
      "(" + file + ")",
    );
    const { id: benchmarkResultID } = db
      .query(
        `
        INSERT INTO benchmarkResults (results) VALUES (?) RETURNING id
      `,
      )
      .get(JSON.stringify(benchmarks));
    db.run(
      `
      INSERT INTO runs (runtime, runtimeVersion, benchmarkID, timestamp, elapsed, benchmarkResultID) VALUES (
        ?, ?, ?, ?, ?, ?)`,
      runtime,
      runtimeVersion,
      benchmarkID,
      timestamp,
      elapsed,
      benchmarkResultID,
    );
  }
}
