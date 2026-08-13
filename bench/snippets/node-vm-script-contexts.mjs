// @runtime bun
//
// How much does one vm.Script cost per context it runs in?
//
//   bun bench/snippets/node-vm-script-contexts.mjs [sourceMegabytes=5] [contexts=3] [--cached-data] [--evict]
//
// Generates a `(function (exports, require, module) { ...many functions... })` source of the
// requested size (the shape of a `bun build --format=cjs` bundle), constructs one Script from it
// and runs it in N fresh contexts, invoking the returned wrapper each time. For every phase it
// prints the wall time, and how many times JSC's parser ran (counted from the lines JSC
// writes to stderr under BUN_JSC_reportParseTimes=1, in a child process running the same
// phases), followed by the unlinked code cells left alive at the end.
//
//   --cached-data   construct the measured Script from another Script's cachedData
//   --evict         compile an unrelated 16.5 MB script between the first and second context,
//                   which is enough to make JSC's CodeCache drop the measured Script's entry
import { Script, createContext } from "node:vm";
import { heapStats } from "bun:jsc";

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith("--")));
const [megabytes = "5", contexts = "3"] = args.filter(a => !a.startsWith("--"));
const CHILD = "--child";

function makeSource(bytes) {
  const parts = ["(function (exports, require, module) {\n"];
  let size = parts[0].length;
  for (let i = 0; size < bytes; i++) {
    const fn = `function f${i}(a, b) { var x = a + ${i}; if (x > b) return "s${i}" + x; for (var j = 0; j < ${i % 7}; j++) x += j; return x - b; }\n`;
    parts.push(fn);
    size += fn.length;
  }
  parts.push("module.exports = f0(1, 2);\n})");
  return parts.join("");
}

function runPhases(report) {
  // Compile node:vm's own lazily compiled helpers first so they don't show up in the phases.
  new Script("1;", { produceCachedData: true }).runInContext(createContext({}));
  const source = makeSource(Number(megabytes) * 1e6);
  let start = performance.now();
  const options = flags.has("--cached-data") ? { cachedData: new Script(source).createCachedData() } : {};
  report.mark("construct");
  start = performance.now();
  const script = new Script(source, options);
  report.done("construct", start);

  const keep = [];
  for (let i = 0; i < Number(contexts); i++) {
    if (flags.has("--evict") && i === 1) {
      report.mark("evict");
      start = performance.now();
      new Script(makeSource(16.5e6) + "// unrelated").runInContext(createContext({}));
      report.done("evict", start);
    }
    const context = createContext({});
    report.mark(`context ${i}: evaluate`);
    start = performance.now();
    const wrapper = script.runInContext(context);
    report.done(`context ${i}: evaluate`, start);
    report.mark(`context ${i}: invoke`);
    start = performance.now();
    const module = { exports: {} };
    wrapper(module.exports, () => {}, module);
    report.done(`context ${i}: invoke`, start);
    keep.push(wrapper, module);
  }
  report.mark("end");
  return keep;
}

if (args.includes(CHILD)) {
  // Only the phase markers go to stderr from us; everything else on stderr is JSC's parse log.
  runPhases({ mark: name => console.error(`@@${name}`), done() {} });
} else {
  const times = new Map();
  const keep = runPhases({
    mark() {},
    done: (name, start) => times.set(name, performance.now() - start),
  });

  const child = Bun.spawnSync({
    cmd: [process.execPath, import.meta.path, ...args, CHILD],
    env: { ...process.env, BUN_JSC_reportParseTimes: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const parses = new Map();
  let phase = "startup";
  for (const line of child.stderr.toString().split("\n")) {
    if (line.startsWith("@@")) phase = line.slice(2);
    else if (line.startsWith("Parsed ")) parses.set(phase, (parses.get(phase) ?? 0) + 1);
  }

  console.log(
    `${megabytes} MB source, ${contexts} contexts${[...flags].length ? ", " + [...flags].join(" ") : ""} (${process.versions.bun})`,
  );
  console.log("phase".padEnd(24) + "wall ms".padStart(10) + "parses".padStart(9));
  for (const [name, ms] of times) {
    console.log(name.padEnd(24) + ms.toFixed(1).padStart(10) + String(parses.get(name) ?? 0).padStart(9));
  }

  Bun.gc(true);
  const counts = heapStats().objectTypeCounts;
  console.log(
    `live at end: UnlinkedProgramCodeBlock=${counts.UnlinkedProgramCodeBlock ?? 0} ` +
      `UnlinkedFunctionExecutable=${counts.UnlinkedFunctionExecutable ?? 0} ` +
      `FunctionExecutable=${counts.FunctionExecutable ?? 0} (keeping ${keep.length} results alive)`,
  );
}
