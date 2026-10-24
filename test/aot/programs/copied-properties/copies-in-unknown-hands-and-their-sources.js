// Copies made by Object.assign and by spread go to code that nobody compiles, which changes them in every way it can. The sources are read afterwards: each holds
// what the program itself has put there. What the copies held is in those hands too: functions out of them are called, objects out of them are changed.
const run = new Function("copy", "log", `
  for (const key of Reflect.ownKeys(copy)) {
    const value = copy[key];
    if (typeof value === "function") log.push("called " + String(key) + ": " + value.call({ tag: "theirs" }, 1));
    else if (value && typeof value === "object") { value.touched = (value.touched || 0) + 1; }
  }
  Object.defineProperty(copy, "indent", { get() { return "a getter of theirs"; }, configurable: true, enumerable: true });
  copy.added = "by them"; delete copy.strict; Object.setPrototypeOf(copy, { inherited: "from them" });
  return copy;`);
const log = [];
const shared = { depth: 1 };
const symbol = Symbol("mark");
function defaults() { return { indent: 2, strict: true, name: "defaults", shared, format(n) { return this.tag + " " + n; }, [symbol]: "under a symbol" }; }

function read(options) { return [options.indent, options.strict, options.name, options.added, options.inherited, typeof options.format, options[symbol], Object.keys(options).join()].join(" | "); }

const first = defaults();
const assigned = run(Object.assign({ own: 1 }, first), log);
console.log(read(first)); console.log(read(assigned));

const second = defaults();
const spread = run({ ...second, own: 2 }, log);
console.log(read(second)); console.log(read(spread));

// A copy of a copy: the one in the middle is handed to nobody either.
const third = defaults(), middle = Object.assign({}, third, { name: "middle" });
const last = run({ ...middle }, log);
console.log(read(third)); console.log(read(middle)); console.log(read(last));

// A source with a getter: it runs at the copy, with the source as its receiver, and what it answers is a plain value of the copy.
let runs = 0;
const computed = { get indent() { runs++; return this.base * 2; }, base: 4, strict: false };
const ofComputed = run(Object.assign({}, computed), log);
console.log(runs, computed.indent, runs, read(computed)); console.log(read(ofComputed));

// The descriptors of a source put its accessors themselves on the copy: they are in those hands, and run on whatever they are called on.
const described = run(Object.defineProperties({}, Object.getOwnPropertyDescriptors({ get strict() { return "getter on " + (this.tag ?? "the copy"); }, tag: undefined })), log);
console.log(read(described));

// The sources go on living in the program: later stores to them reach no copy, and later copies see them.
first.indent = 8; second.name = "second"; third.strict = null;
console.log(read(Object.assign({}, first, second, third)), assigned.indent, spread.name);
console.log(shared.touched, shared.depth, log.join("; "));

class Options { constructor() { this.indent = 3; this.strict = true; } get name() { return "of the class"; } }
const instance = new Options(), ofInstance = run({ ...instance }, log);
console.log(read(instance), instance instanceof Options); console.log(read(ofInstance), ofInstance instanceof Options);
console.log(read(run(Object.assign([], [1, 2], { indent: 1 }), log)), read(run({ ..."ab" }, log)), read(run({ ...null, ...undefined, ...7 }, log)));
