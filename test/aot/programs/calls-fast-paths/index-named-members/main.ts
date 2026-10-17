// Class members whose names are array indices: setters, getters and methods, on the prototype and on the class, in typed and untyped code.
// @ts-ignore
import untyped from "./untyped-classes-with-index-named-members.js";
declare const console: any;
const said: string[] = [];
function block(name: string, body: () => void) { try { body(); } catch (error) { said.push(name + ": THROWS " + (error as Error).constructor.name); } }
function storeAt2(target: any, value: unknown) { target[2] = value; }
function readAt(target: any, index: number): unknown { return target[index]; }
const table = [storeAt2, readAt] as const;

class Typed1 { set 2(v: string) { said.push("Typed1's setter " + v); } get 3(): string { return "Typed1's getter"; } 4(): string { return "Typed1's method"; } }
block("typed", () => { const o = new Typed1(); o[2] = "a"; said.push("typed: own 2: " + Object.prototype.hasOwnProperty.call(o, 2) + " | " + o[3] + " | " + typeof o[4] + " | " + o[4]()); });

class Untyped1 { set 2(v: string) { said.push("Untyped1's setter " + v); } get 3(): string { return "Untyped1's getter"; } 4(): string { return "Untyped1's method"; } }
block("in untyped hands", () => { const o = new Untyped1(); table[0](o, "b"); said.push("in untyped hands: own 2: " + Object.prototype.hasOwnProperty.call(o, 2) + " | " + table[1](o, 3) + " | " + typeof table[1](o, 4)); });

class ReadFirst { get 0(): string { return "ReadFirst's getter"; } }
block("a read first", () => { said.push("a read first: " + table[1](new ReadFirst(), 0)); });

class InFirst { 7(): number { return 7; } }
block("`in` first", () => { said.push("`in` first: " + (7 in new InFirst()) + " " + (8 in new InFirst())); });

class ReflectFirst { set 5(v: string) { said.push("ReflectFirst's setter " + v); } }
block("Reflect.set first", () => { const o = new ReflectFirst(); said.push("Reflect.set first: " + Reflect.set(o, 5, "c") + " own 5: " + Object.prototype.hasOwnProperty.call(o, 5)); });

class Static1 { static 2(): string { return "Static1's method"; } static get 3(): string { return "Static1's getter"; } static set 4(v: string) { said.push("Static1's setter " + v); } }
block("static", () => { const c: any = Static1; said.push("static: " + typeof c[2] + " | " + c[3]); c[4] = "d"; said.push("static: own 4 is an accessor: " + (typeof Object.getOwnPropertyDescriptor(c, 4)!.set)); });

const two = 2, text = "3", big = 4n;
class Computed1 { [two](): string { return "[2]"; } [text](): string { return '["3"]'; } [big as any](): string { return "[4n]"; } }
block("computed", () => { const o: any = new Computed1(); said.push("computed: " + o[2]() + " " + o[3]() + " " + o[4]()); });

block("a literal", () => { const o: any = { 2() { return "a literal's method"; }, get 3() { return "a literal's getter"; }, set 4(v: string) { said.push("a literal's setter " + v); } }; o[4] = "e"; said.push("a literal: " + o[2]() + " | " + o[3]); });

class Base1 { 2(): string { return "Base1's 2"; } get 3(): string { return "Base1's 3"; } set 4(v: string) { said.push("Base1's setter " + v); } }
class Heir1 extends Base1 { viaSuper(): string { return super[2]() + " by super"; } named(): string { return "named"; } }
block("an heir without such members", () => { const o = new Heir1(); o[4] = "f"; said.push("an heir without such members: own 4: " + Object.prototype.hasOwnProperty.call(o, 4) + " | " + o[3] + " | " + o.viaSuper() + " | " + o.named()); });

class Base2 { named(): string { return "Base2's named"; } }
class Heir2 extends Base2 { get 1(): string { return "Heir2's 1"; } }
block("an heir with one", () => { said.push("an heir with one, of a base without: " + table[1](new Heir2(), 1) + " | " + new Heir2().named()); });

class ForArray { set 2(v: string) { said.push("ForArray's setter " + v); } }
block("an array given the prototype", () => { const o = Object.setPrototypeOf(["a", "b", , "d"], ForArray.prototype); table[0](o, "g"); said.push("an array given the prototype: own 2: " + Object.prototype.hasOwnProperty.call(o, 2)); });

class NoIndices { "4294967295"(): string { return "4294967295"; } "-1"(): string { return "-1"; } "1.5"(): string { return "1.5"; } "01"(): string { return "01"; } }
block("no indices", () => { const o: any = new NoIndices(); said.push("names that look like numbers and are no indices: " + o[4294967295]() + " " + o[-1]() + " " + o[1.5]() + " " + o["01"]() + " " + typeof o[1]); });

class Largest { 4294967294(): string { return "the largest index"; } }
block("the largest index", () => { said.push("" + (table[1](new Largest(), 4294967294) as () => string)()); });

block("arrays behind all that", () => { const numbers = [1, 2, 3]; numbers.push(4); const holes: unknown[] = [1, , 3]; said.push("arrays behind all that: " + numbers.join() + " | " + holes[1] + " | " + holes.length); });
console.log(said.join("\n"));
const m: any = untyped;
console.log(m.all().join("\n")); console.log(m.lines.join("\n"));
export {};
