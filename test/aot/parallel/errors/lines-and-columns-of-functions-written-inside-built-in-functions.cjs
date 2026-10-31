// A stack lists a function that Bun's library writes inside a built-in function as `at name (native:line:column)`: the methods of a Console, process.nextTick, the function that runs the ticks.
// The line and the column are printed as they are. So is the frame of the validator that refuses a callback of process.nextTick which is no function.
const { Console } = require("node:console");
const { createHook } = require("node:async_hooks");

const framesOf = stack =>
  String(stack)
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/(\(|^at )[^ ()]*[\\/]/, "$1"))
    .join(" < ");

function sitesOf(error) {
  const before = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, sites) =>
    sites
      .map(site =>
        [
          site.getFunctionName(),
          // `unknown:40:20`. A Bun built with assertions counts other lines and columns in a built-in function, and run-parallel.ts knows them in that form.
          [String(site.getFileName()).replace(/^.*[\\/]|^\[|\]$/g, ""), site.getLineNumber(), site.getColumnNumber()].join(":"),
          site.isNative(),
          String(site).replace(/\([^ ()]*[\\/]/, "("),
        ].join(" "),
      )
      .join(" < ");
  const text = error.stack;
  Error.prepareStackTrace = before;
  return text;
}

const written = [];
const sink = {
  write() {
    written.push(new Error());
    return true;
  },
  on() {},
  once() {},
  removeListener() {},
  listenerCount() {
    return 0;
  },
};
const mine = new Console({ stdout: sink, stderr: sink });
const uses = {
  log: () => mine.log("a"),
  info: () => mine.info("a"),
  debug: () => mine.debug("a"),
  warn: () => mine.warn("a"),
  error: () => mine.error("a"),
  dir: () => mine.dir({}),
  dirxml: () => mine.dirxml({}),
  table: () => mine.table([{ a: 1 }]),
  tableOfNoObject: () => mine.table(1),
  group: () => mine.group("a"),
  groupCollapsed: () => mine.groupCollapsed("a"),
  count: () => mine.count(),
  assert: () => mine.assert(false, "a"),
  trace: () => mine.trace("a"),
  timeEnd: () => (mine.time("a"), mine.timeEnd("a")),
};
for (const [name, use] of Object.entries(uses)) {
  use();
  console.log("Console", name, written.map(error => framesOf(error.stack)).join(" | "));
  written.length = 0;
}
for (const options of [{ stdout: 1 }, { stdout: sink, colorMode: 3 }, { stdout: sink, groupIndentation: -1 }]) {
  try {
    new Console(options);
  } catch (error) {
    console.log("Console refuses", error.code, framesOf(error.stack));
  }
}

for (const value of [undefined, 1, {}, null, "text"]) {
  try {
    process.nextTick(value);
  } catch (error) {
    console.log("no function", typeof value, error.code, framesOf(error.stack));
  }
}
try {
  process.nextTick(null, 1, 2, 3, 4);
} catch (error) {
  console.log("sites of no function", sitesOf(error));
}

let seen = [];
const hook = createHook({
  init(id, type) {
    if (type === "TickObject") seen.push(new Error());
  },
});
function ran() {}
for (let count = 0; count <= 5; count++) {
  hook.enable();
  try {
    process.nextTick(ran, ...Array(count).fill(0));
  } finally {
    hook.disable();
  }
  console.log("init hook", count, seen.map(error => framesOf(error.stack)).join(" | "));
  seen = [];
}
hook.enable();
process.nextTick(ran);
hook.disable();
console.log("sites below a hook", sitesOf(seen[0]));

Object.defineProperty(process, "_exiting", {
  configurable: true,
  get() {
    console.log("getter", framesOf(new Error().stack));
    return false;
  },
});
process.nextTick(ran);
process.nextTick(ran, 1, 2, 3, 4);
delete process._exiting;

process.nextTick(function tick() {
  console.log("tick", framesOf(new Error().stack));
  console.log("sites of a tick", sitesOf(new Error()));
});
