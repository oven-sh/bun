// The other roads into the same form: a class whose constructor hands all it gets to the class above, constructed by value; async functions and generators with `...rest`; functions that read `arguments`.
class Base { parts: unknown[]; constructor(...parts: unknown[]) { this.parts = parts; } }
class Middle extends Base { constructor(...parts: unknown[]) { super("middle", ...parts); } }
class Top extends Middle { }
class Beside { parts: unknown[]; constructor(first?: unknown, ...parts: unknown[]) { this.parts = [parts.length, first, ...parts]; } }
const classes: (new (...given: unknown[]) => { parts: unknown[] })[] = [Base, Middle, Top, Beside];
const said: string[] = [];
function own(..._: unknown[]) { return arguments.length + ":" + Array.prototype.join.call(arguments); }
function ownBehind(a?: unknown, b?: unknown, ..._: unknown[]) { return String(a) + String(b) + arguments.length + ":" + Array.prototype.slice.call(arguments, 1).join(); }
function ownAlone() { return arguments.length + "!" + Array.prototype.join.call(arguments, "/"); }
async function later(first?: unknown, ...rest: unknown[]) { await null; return String(first) + rest.length + ":" + rest.join(); }
async function laterAll(...rest: unknown[]) { await null; return rest.length + "=" + rest.join(); }
async function laterTwo(first?: unknown, second?: unknown, ...rest: unknown[]) { await null; return String(first) + String(second) + rest.length + "~" + rest.join(); }
function* steps(...rest: unknown[]) { for (const value of rest) yield value; return rest.length; }
function* stepsBehind(first?: unknown, ...rest: unknown[]) { yield first; for (const value of rest) yield value; }
function* stepsBack(...rest: unknown[]) { for (let i = rest.length; i-- > 0;) yield rest[i]; }
const plain: ((...given: unknown[]) => unknown)[] = [own, ownBehind, ownAlone as (...given: unknown[]) => unknown];
const laters: ((...given: unknown[]) => Promise<string>)[] = [later, laterAll, laterTwo];
const generators: ((...given: unknown[]) => Iterable<unknown>)[] = [steps, stepsBehind, stepsBack];
const waits: Promise<string>[] = [];
for (let turn = 0; turn < 30; turn++) {
  said.length = 0; waits.length = 0;
  for (const made of classes) said.push(new made().parts.join(), new made(1).parts.join(), new made(1, 2, 3, 4, 5, 6).parts.join(), Reflect.construct(made, [9, 8]).parts.join());
  for (const called of plain) said.push(String(called()), String(called(1)), String(called(1, 2, 3, 4, 5, 6, 7)));
  for (const called of laters) waits.push(called(), called("a"), called("a", 1, 2, 3, 4, 5));
  for (const called of generators) said.push([...called()].join(), [...called(1)].join(), [...called(1, 2, 3, 4, 5, 6)].join());
}
console.log(said.join("\n"));
console.log((await Promise.all(waits)).join("\n"));
