import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned, told } from "./harness/commands";
import { test } from "./supported";

// A generator of a function that nobody has asked for its `prototype` stands on an object that stands for it. The first time such an object is made, every generator of the realm is given its own and
// the short form ends for the realm, so one process tries one way only: the argument picks it.
const main = String.raw`const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
function make(tag) {
  return hide(function* () {
    yield tag;
    yield tag + tag;
  });
}
const out = [];
const look = g => { const seen = []; const attempt = run => { try { seen.push(String(run())); } catch (error) { seen.push(error.constructor.name); } };
  attempt(() => g.extra); attempt(() => g[0]); attempt(() => Object.prototype.toString.call(g)); attempt(() => [...g].join("+")); attempt(() => "extra" in g); attempt(() => 0 in g); attempt(() => { const names = []; for (const name in g) names.push(name); return names.join(); });
  attempt(() => g.next === Object.getPrototypeOf(Object.getPrototypeOf(function* () {}).prototype).next || typeof g.next); attempt(() => String(g.return)); return seen.map(text => text.length > 40 ? text.slice(0, 12) + ".." : text).join(" | "); };
const ways = {
  "a name": p => { p.extra = "added"; },
  "a symbol: toStringTag": p => { p[Symbol.toStringTag] = "Mine"; },
  "a symbol: iterator": p => { p[Symbol.iterator] = function () { return ["other"][Symbol.iterator](); }; },
  "an index": p => { p[0] = "zero"; },
  "defineProperty, a getter": p => { Object.defineProperty(p, "extra", { get() { return "got"; }, enumerable: true }); },
  "defineProperty, a symbol": p => { Object.defineProperty(p, Symbol.toStringTag, { value: "Defined" }); },
  "defineProperty, an index": p => { Object.defineProperty(p, 0, { value: "defined" }); },
  "defineProperties": p => { Object.defineProperties(p, { extra: { value: "many", enumerable: true }, next: { value: () => ({ done: true, value: undefined }) } }); },
  "assign": p => { Object.assign(p, { extra: "assigned", 0: "assigned" }); },
  "__defineGetter__": p => { p.__defineGetter__("extra", () => "old way"); },
  "Reflect.set": p => { Reflect.set(p, "extra", "reflected"); },
  "Reflect.defineProperty": p => { Reflect.defineProperty(p, "extra", { value: "reflected" }); },
  "next of its own": p => { p.next = function () { return { done: true, value: "mine" }; }; },
  "return of its own": p => { p.return = "not a function"; },
  "a new parent": p => { Object.setPrototypeOf(p, { extra: "from above", 0: "above", [Symbol.toStringTag]: "Above" }); },
  "no parent": p => { Object.setPrototypeOf(p, null); },
  "__proto__": p => { p.__proto__ = { extra: "dunder" }; },
  "frozen": p => { Object.freeze(p); },
  "a store through the generator": (p, g) => { g.extra = "own"; },
  "a name, then deleted": p => { p.extra = 1; delete p.extra; },
  "by a key nobody knows": p => { p[hide("ex" + "tra")] = "computed"; },
  "by a symbol nobody knows": p => { p[hide(Symbol.toStringTag)] = "Computed"; },
  "only asked, through the function": () => {},
  "only asked, through the generator": (p, g) => { hide(Object.getPrototypeOf(g)); },
  "class fields copy": p => { for (const [key, value] of Object.entries({ extra: "entries" })) p[key] = value; },
};
// The first change of all ends the short form for the realm, so each way wants a process of its own: the argument picks one.
const only = process.argv[2];
for (const [name, change] of Object.entries(ways).filter((way, index) => only === undefined || String(index) === only)) {
  const f = make("x"), fresh = hide(f()), begun = hide(f()), other = hide(make("y")());
  begun.next();
  let said = "";
  try { change(hide(f.prototype), fresh); } catch (error) { said = " (" + error.constructor.name + ")"; }
  out.push(name + said + "\n  fresh: " + look(fresh) + "\n  begun: " + look(begun) + "\n  made behind it: " + look(hide(f())) + "\n  of another function: " + look(other));
}
console.log(out.join("\n"));
`;
const numberOfWays = main.split("\n").filter(line => /^  "[^"]+": \(?[a-z, ]*\)? => /.test(line)).length;

test("every way to ask for, or to change, the prototype object of a generator function whose generators are alive", async () => {
  expect(numberOfWays).toBe(25);
  using dir = tempDir("aot-prototype-of-a-generator-function", { "main.js": main });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "main.exe" : "main");
  await slot(async () => {
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", executable], folder, bunEnv),
    );
    for (let way = 0; way < numberOfWays; way++)
      expect({ way, ...told(await spawned([executable, String(way)], folder, bunEnv)) }).toEqual({
        way,
        ...told(await spawned([bunExe(), "./main.js", String(way)], folder, bunEnv)),
      });
  });
}, 240_000);
