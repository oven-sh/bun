// One name asked of an instance of a class that defines it and, at the same place, of primitives, arrays, functions and literals.
const log = (...a) => console.log(a.map(String).join(" "));
class C1 { } log(1, [new C1(), 1].map(v => v.constructor.name).join());
class C2 { toString() { return "C2"; } } log(2, [new C2(), 1, "s", true, 2n, Symbol.iterator, [3], () => 4, {}].map(v => v.toString()).join("|"));
class C3 { valueOf() { return 3; } } log(3, [new C3(), 1, "s", false, {}].map(v => typeof v.valueOf()).join());
class C4 { at() { return "C4"; } } log(4, [new C4(), "text", [7, 8]].map(v => v.at(0)).join());
class C5 { get length() { return "C5"; } } log(5, [new C5(), "text", [7, 8], () => 1].map(v => v.length).join());
class C6 { hasOwnProperty() { return "C6"; } } log(6, [new C6(), {}, [], 1].map(v => v.hasOwnProperty("x")).join());
class A7 { m() { return "A7"; } } class B7 extends A7 { m() { return "B7"; } } log(7, [new B7(), new A7(), { m() { return "literal"; } }, Object.create({ m() { return "created"; } })].map(v => v.m()).join());
