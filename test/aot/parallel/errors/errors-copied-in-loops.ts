// Copies of errors by spread, rest and Object.assign(): errors whose stack was read before and others, own properties of each kind, symbols, indexes, accessors, enumerable stacks, prepareStackTrace.
export {};
const lines: string[] = [];
let order = "";
const places = ["line", "column", "originalLine", "originalColumn", "sourceURL"];
const show = (value: any) => Reflect.ownKeys(value).filter(key => !places.includes(String(key))).map(key => { const d = Object.getOwnPropertyDescriptor(value, key)!; return String(key) + (d.enumerable ? "e" : "-") + (d.writable ? "w" : "-") + (d.configurable ? "c" : "-") + (d.get ? "g" : String(key) === "stack" ? typeof d.value : String(d.value).split("\n")[0]); }).join(",");
const attempt = (read: () => unknown) => { try { return String(read()); } catch (error) { return (error as Error).constructor.name + (error as Error).message; } };
class Mine extends Error { code = 1; detail = { a: 1 }; }
class Accessed extends Error { get level() { return 3; } }
const key = Symbol("key"), hidden = Symbol("hidden");
const makers: Record<string, () => any> = {
  plain: () => new Error("a"), code: () => Object.assign(new TypeError("b"), { code: "X", errno: -2 }), mine: () => new Mine("c"), accessed: () => new Accessed("d"), cause: () => new Error("e", { cause: new Error("f") }), aggregate: () => new AggregateError([1], "g"),
  symbols: () => Object.assign(new Error("h"), { [key]: 1, z: 2, a: 3 }), hiddenSymbol: () => Object.defineProperty(Object.assign(new Error("i"), { a: 1 }), hidden, { value: 5, enumerable: false }), indexed: () => Object.assign(new Error("j"), { 3: "three", 1: "one", a: 1 }), getter: () => Object.defineProperty(Object.assign(new Error("k"), { a: 1 }), "got", { get() { order += "g"; return order.length; }, enumerable: true, configurable: true }),
  stackEnumerable: () => Object.defineProperty(new Error("l"), "stack", { value: "own stack", enumerable: true, writable: true, configurable: true }), stackStored: () => { const e: any = new Error("m"); e.stack = "stored"; e.a = 1; return e; }, stackDeleted: () => { const e: any = new Error("n"); delete e.stack; e.b = 2; return e; }, messageEnumerable: () => Object.defineProperty(new Error("o"), "message", { enumerable: true }),
  frozen: () => Object.freeze(Object.assign(new Error("p"), { a: 1 })), captured: () => { const e: any = Object.assign(new Error("q"), { a: 1 }); Error.captureStackTrace(e); return e; }, wide: () => { const e: any = new Error("r"); for (let k = 0; k < 80; k++) e["k" + k] = k; delete e.k5; return e; }, proto: () => Object.setPrototypeOf(Object.assign(new Error("s"), { a: 1 }), { b: 2 }), underscore: () => { const e: any = new Error("t"); Object.defineProperty(e, "__proto__", { value: 7, enumerable: true, configurable: true, writable: true }); return e; },
  thrown: () => { try { (null as any).x; } catch (error) { return Object.assign(error as Error, { at: 1 }); } }, dom: () => new DOMException("u", "AbortError"), cloned: () => structuredClone(new RangeError("v")), file: () => { try { require("node:fs").readFileSync("/nowhere/at/all"); } catch (error) { return error; } },
};
const ways: Record<string, (e: any) => any> = {
  spread: e => ({ ...e }), behind: e => ({ a: 0, ...e, z: 9 }), twice: e => ({ ...e, ...e }), rest: ({ a, ...rest }: any) => rest, restOfCode: ({ code, message, ...rest }: any) => rest, assign: e => Object.assign({}, e), assignOver: e => Object.assign({ a: 5, code: 6 }, e), into: e => Object.assign(new Mine("target"), e), entries: e => Object.fromEntries(Object.entries(e)), json: e => JSON.parse(JSON.stringify(e)),
};
for (let turn = 0; turn < 3; turn++) {
  for (const [name, make] of Object.entries(makers)) {
    const error = make();
    for (const [way, copy] of Object.entries(ways)) {
      let text = name + " " + way;
      for (let i = 0; i < 3; i++) { order = ""; text += " | " + attempt(() => show(copy(error))) + order; if (i === 0 && turn) text += typeof error.stack; }
      lines.push(text.replace(/key\)ewc1/, "KEY"));
    }
  }
}
function loops(error: any, turns: number) { let r = ""; for (let i = 0; i < turns; i++) { const copy = { ...error, message: error.message, name: error.name }; r += Object.keys(copy).join() + copy.code; if (i === 2) error.late = i; if (i === 4) delete error.code; if (i === 6) Object.defineProperty(error, "late", { enumerable: false }); } return r; }
lines.push(loops(Object.assign(new Error("w"), { code: "Y" }), 9), loops(new Mine("x"), 9));
(Error as any).prepareStackTrace = (error: Error) => { order += "P" + error.message; return "prepared"; };
for (const read of [false, true]) {
  order = "";
  const error: any = Object.assign(new Error("y"), { code: 1 });
  if (read) void error.stack;
  for (let i = 0; i < 3; i++) lines.push(show({ ...error }) + order + typeof error.stack);
}
for (const line of lines) console.log(line);
