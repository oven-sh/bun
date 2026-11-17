// error.message in loops: errors of the engine and of the program, messages that are replaced, deleted, hidden behind getters, inherited or missing, errors with properties in another order, many structures, collections between two rounds.
export {};
const lines: string[] = [];
const attempt = (read: () => unknown) => { try { return String(read()); } catch (error) { return (error as Error).constructor.name; } };
class Mine extends Error { code = 1; }
class Deep extends Mine { extra = 2; }
class Named extends Error { constructor(text: string) { super(text); this.name = "Named"; } }
class Late extends Error { code: number; constructor(text: string) { super(); this.code = 7; this.message = text; } }
class Field extends Error { override message = "field"; }
class Getter extends Error { override get message() { return "getter"; } }
const thrown = (act: () => unknown): Error => { try { act(); } catch (error) { return error as Error; } return new Error("none"); };
const makers: Record<string, () => any> = {
  error: () => new Error("a"), type: () => new TypeError("bb"), range: () => new RangeError("ccc"), syntax: () => new SyntaxError("d"), uri: () => new URIError("e"), reference: () => new ReferenceError("f"), evaluation: () => new EvalError("g"), aggregate: () => new AggregateError([1], "h"),
  caused: () => new Error("i", { cause: 1 }), bare: () => new Error(), empty: () => new Error(""), called: () => Error("j"), mine: () => new Mine("m"), deep: () => new Deep("n"), named: () => new Named("o"), late: () => new Late("p"), field: () => new Field("q"), getter: () => new Getter("r"),
  replaced: () => Object.assign(new Error("s"), { message: "replaced" }), number: () => Object.assign(new Error("t"), { message: 5 }), nothing: () => Object.assign(new Error("u"), { message: undefined }), removed: () => { const e: any = new Error("v"); delete e.message; return e; }, again: () => { const e: any = new Error("w"); delete e.message; e.code = 1; e.message = "again"; return e; },
  accessor: () => Object.defineProperty(new Error("x"), "message", { get() { return "accessor"; }, configurable: true }), frozen: () => Object.freeze(new Error("y")), stacked: () => { const e = new Error("z"); void e.stack; return e; }, captured: () => { const e = new Error("A"); Error.captureStackTrace(e); return e; }, wide: () => { const e: any = new Error("B"); for (let k = 0; k < 200; k++) e["k" + k] = k; delete e.k0; return e; },
  widest: () => { const e: any = new Error("C"); for (let k = 0; k < 200; k++) e["k" + k] = k; delete e.k0; delete e.message; return e; }, below: () => Object.create(new Error("D")), raised: () => Object.setPrototypeOf(new Error("E"), null), turned: () => Object.setPrototypeOf({ message: "F" }, Error.prototype), plain: () => ({ message: "G" }), other: () => ({ code: 1, message: "H" }), list: () => Object.assign([1], { message: "I" }), wrapped: () => new Proxy(new Error("J"), {}), trapped: () => new Proxy({}, { get: (_, key) => "trap " + String(key) }),
  nothrow: () => thrown(() => (null as any).x), parsed: () => thrown(() => JSON.parse("{")), lengths: () => thrown(() => new Array(-1)), cloned: () => structuredClone(new TypeError("K")), dom: () => new DOMException("L", "AbortError"), text: () => "text", none: () => null, missing: () => undefined, symbol: () => Symbol("M"), five: () => 5, fn: () => Object.assign(() => 1, { message: "N" }), map: () => Object.assign(new Map(), { message: "O" }),
};
function one(error: Error, turns: number) { let r = ""; for (let i = 0; i < turns; i++) r += error.message; return r; }
function many(errors: Error[], turns: number) { let r = ""; for (let i = 0; i < turns; i++) r += errors[i % errors.length].message + ";"; return r; }
function lengths(errors: Error[]) { let r = 0; for (const error of errors) r += error.message.length; return r; }
function known(errors: unknown[]) { let r = ""; for (const error of errors) r += error instanceof Error ? error.message + "," : typeof error + ","; return r; }
function same(errors: Error[], text: string) { let r = 0; for (let i = 0; i < errors.length; i++) if (errors[i].message === text) r++; return r; }
function stores(error: Error, turns: number) { let r = ""; for (let i = 0; i < turns; i++) { r += error.message; error.message = "m" + i; if (i === 3) Object.defineProperty(error, "message", { value: i, enumerable: true, writable: true, configurable: true }); if (i === 5) delete (error as any).message; if (i === 7) (error as any).code = 1; } return r; }
function caught(turns: number) { let r = ""; for (let i = 0; i < turns; i++) { try { if (i % 3 === 0) throw new Mine("m" + i); if (i % 3 === 1) throw new TypeError("t" + i); (null as any).x(); } catch (error) { r += (error as Error).message.length + ","; } } return r; }
function chain(error: Error) { let r = ""; for (let current: any = error; current; current = current.cause) r += (current as Error).message + ">"; return r; }
function shortest(errors: Error[]) { let best = errors[0]; for (const error of errors) if (error.message.length < best.message.length) best = error; return best.message; }
function build(round: number) { const classes: Error[] = []; for (let k = 0; k < 40; k++) { const Local = class extends Error { tag = k; }; classes.push(new Local("local" + round + "-" + k)); } return classes; }
const errors = ["error", "type", "range", "mine", "deep", "named", "late", "caused"].map(name => makers[name]() as Error);
for (let round = 0; round < 3; round++) {
  for (const [name, make] of Object.entries(makers)) {
    const value = make();
    lines.push(name + " " + attempt(() => one(value, 3)) + " " + attempt(() => many([errors[0], value, errors[1], value], 5)) + " " + attempt(() => lengths([errors[2], value])) + " " + attempt(() => known([value, value])) + " " + attempt(() => same([value, errors[0]], "a")));
  }
  lines.push(many(errors, 17), String(lengths(errors)), known(errors), String(same(errors, "a")), shortest(errors), caught(7), chain(new Error("outer", { cause: new TypeError("inner", { cause: new Mine("last") }) })));
  for (const name of ["error", "type", "mine", "late", "frozen"]) lines.push(attempt(() => stores(makers[name](), 10)));
  for (let k = 0; k < 4; k++) { const local = build(round * 4 + k); lines.push(many(local, 41) + lengths(local)); Bun.gc(true); }
}
const mixed = Object.values(makers).slice(0, 18).map(make => make() as Error);
for (let round = 0; round < 3; round++) { lines.push(many(mixed, 40)); mixed.reverse(); if (round === 1) { (mixed[0] as any).code = 1; delete (mixed[1] as any).message; Object.defineProperty(mixed[2], "message", { get: () => "late getter" }); } }
Object.defineProperty(Mine.prototype, "message", { value: "from the prototype", configurable: true });
lines.push(many([new Mine("own"), new Mine()], 4));
for (const line of lines) console.log(line);
