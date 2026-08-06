// JetStream2 shell-runner shim for bun/node: provides load/readFile/runString/print like the jsc shell.
const vm = require("vm"), fs = require("fs"), path = require("path");
const dir = process.env.JETSTREAM_DIR || path.join(process.env.HOME, "code/WebKit/PerformanceTests/JetStream2");
process.chdir(dir);
const origLog = console.log.bind(console);
globalThis.print = (...a) => origLog(...a);
globalThis.window = { location: { search: "" } }; // JetStreamDriver probes URLSearchParams(window.location.search)

globalThis.readFile = p => fs.readFileSync(path.resolve(dir, p), "utf8");
globalThis.readRelativeToScript = globalThis.readFile;
globalThis.read = (p, mode) => mode === "binary" ? new Uint8Array(fs.readFileSync(path.resolve(dir, p))) : fs.readFileSync(path.resolve(dir, p), "utf8");
globalThis.document = { getElementById: () => ({}) }; // reportError touches the DOM
globalThis.load = p => vm.runInThisContext(fs.readFileSync(path.resolve(dir, p), "utf8"), { filename: p });
globalThis.runString = s => {
  const ctx = vm.createContext({});
  const g = vm.runInContext("globalThis", ctx);
  g.print = globalThis.print; g.readFile = globalThis.readFile; g.read = globalThis.read;
  g.loadString = code => vm.runInContext(code, ctx);
  g.performance = performance; g.setTimeout = setTimeout;
  if (s) g.loadString(s);
  return g;
};
if (process.argv[2]) globalThis.testList = process.argv.slice(2); // optional subset
load("./cli.js");
