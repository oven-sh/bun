// Code that type-checks and in which a written type is false at run time, or that writes to a built-in: a store to a locked built-in throws, and everything else is as in plain Bun: a value of another kind gets where it is put and is read as what it is, and the program's own objects and classes and the built-ins that are not locked change as they are told.
function show(label: string, f: () => unknown) { try { const v = f(); console.log(label + " => " + (typeof v === "string" ? JSON.stringify(v) : String(v))) } catch (e) { console.log(label + " => throws " + (e as Error).constructor.name) } }
interface User { name: string; age: number }
interface Point { x: number; y: number }
class Account { constructor(public owner: string, public balance: number) {} deposit(n: number) { this.balance += n; return this.balance } }

show("01 a field of another kind in annotated JSON", () => { const u: User = JSON.parse('{"name":"ada","age":"36"}'); return u.age + 1 });
show("02 good JSON passes", () => { const u: User = JSON.parse('{"name":"ada","age":36}'); return u.age + 1 });
show("03 missing field", () => { const u: User = JSON.parse('{"name":"ada"}'); return u.age });
show("04 bang on a missing element", () => { function first(xs: number[]) { return xs[0]! } return first([]) });
show("05 bang on optional", () => { function f(o: { n?: number }) { const n = o.n!; return n } return f({}) });
show("06 as number on a string", () => { const raw: any = "5"; return (raw as number) + 1 });
show("07 as string on a number", () => { const raw: any = 5; return (raw as string) + 1 });
show("08 any into a typed parameter", () => { function area(p: Point) { return p.x + p.y } const bad: any = { x: "2", y: 3 }; return area(bad) });
show("09 wrong store through any", () => { const p: Point = { x: 1, y: 2 }; (p as any).x = "one"; return typeof p.x });
show("10 delete a required field", () => { const p: Point = { x: 1, y: 2 }; delete (p as any).x; return p.x });
show("11 extra property is fine", () => { const p: Point = { x: 1, y: 2 }; (p as any).z = 3; return Object.keys(p).join() });
show("12 patch Array.prototype.map", () => { (Array.prototype as any).map = function () { return ["hijacked"] }; return [1, 2].map(x => x * 2).join() });
show("13 prototype pollution", () => { (Object.prototype as any).isAdmin = true; return ({} as any).isAdmin });
show("14 pollution by __proto__", () => { const o: any = {}; o.__proto__.polluted = "yes"; return ({} as any).polluted });
show("15 replace Math.max", () => { (Math as any).max = () => 42; return Math.max(1, 2) });
show("16 add to Math", () => { (Math as any).tau = 6.28; return (Math as any).tau });
show("17 replace JSON.parse", () => { const parse = JSON.parse; (JSON as any).parse = () => "pwned"; try { return JSON.parse("1") } finally { (JSON as any).parse = parse } });
show("18 replace a method of a class", () => { (Account.prototype as any).deposit = function () { return -1 }; return new Account("a", 1).deposit(5) });
show("19 wrong element in a typed array", () => { const xs: number[] = JSON.parse('[1,"2",3]'); let s = 0; for (const x of xs) s += x; return s });
show("20 wrong type returned by any", () => { function parse(s: string): number { const v: any = s; return v } return parse("7") + 1 });
show("21 null into a non-null parameter", () => { function len(s: string) { return s.length } const n: any = null; return len(n) });
show("22 undefined into number", () => { function twice(n: number) { return n * 2 } const u: any = undefined; return twice(u) });
show("23 class instance faked by a literal", () => { function pay(a: Account) { return a.deposit(1) } const fake: any = { owner: "x", balance: 0, deposit() { return 999 } }; return pay(fake) });
show("24 union discriminant lie", () => { type S = { kind: "circle"; r: number } | { kind: "square"; w: number }; const s: S = JSON.parse('{"kind":"triangle","w":1}'); return s.kind });
show("25 enum out of range", () => { enum Color { Red, Green } const c: Color = JSON.parse("7"); return c });
show("26 literal type lie", () => { const mode: "on" | "off" = JSON.parse('"maybe"'); return mode });
show("27 readonly store through any", () => { const p: { readonly id: number } = { id: 1 }; (p as any).id = 2; return p.id });
show("28 freeze still works", () => { const p: Point = Object.freeze({ x: 1, y: 2 }); try { (p as any).x = 5 } catch {} return p.x });
show("29 function text", () => { function secret() { return "s3cr3t" } return String(secret).includes("s3cr3t") });
show("30 Symbol.iterator of arrays replaced", () => { (Array.prototype as any)[Symbol.iterator] = function* () { yield "hijacked" }; return [...[1, 2]].join() });
/* Output:
01 a field of another kind in annotated JSON => "361"
02 good JSON passes => 37
03 missing field => undefined
04 bang on a missing element => undefined
05 bang on optional => undefined
06 as number on a string => "51"
07 as string on a number => 6
08 any into a typed parameter => "23"
09 wrong store through any => "string"
10 delete a required field => undefined
11 extra property is fine => "x,y,z"
12 patch Array.prototype.map => throws TypeError
13 prototype pollution => throws TypeError
14 pollution by __proto__ => throws TypeError
15 replace Math.max => throws TypeError
16 add to Math => 6.28
17 replace JSON.parse => "pwned"
18 replace a method of a class => -1
19 wrong element in a typed array => "123"
20 wrong type returned by any => "71"
21 null into a non-null parameter => throws TypeError
22 undefined into number => NaN
23 class instance faked by a literal => 999
24 union discriminant lie => "triangle"
25 enum out of range => 7
26 literal type lie => "maybe"
27 readonly store through any => 2
28 freeze still works => 1
29 function text => true
30 Symbol.iterator of arrays replaced => throws TypeError
*/
