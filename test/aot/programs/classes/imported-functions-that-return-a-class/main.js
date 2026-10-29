// Functions that return a class are imported: by name, under another name, as the default, through another module, as a namespace.
import Default, { Counted, Renamed, Arrow, Base, calls, Inside1, Inside2 } from "./makers.js";
import * as all from "./again.js";
const lines = [];
class A extends Counted(Base) { } class B extends Renamed(Base) { } class C extends all.Counted(Base) { } class D extends Default(Base) { } class E extends all.Default(A) { }
const F = Arrow(Base), G = all.Arrow(Base);
const classes = [A, B, C, Inside1, Inside2, all.FromAgain];
lines.push(classes.map((X) => classes.map((Y) => (X.has(new Y()) ? 1 : 0)).join("")).join(" "));
lines.push([calls, all.calls, new A().c, new B().c, new C().c, new Inside1().c, new all.FromAgain().c, F.n, G.n].join());
lines.push([A.maker === Counted, B.maker === Renamed, Counted === Renamed, all.Counted === Counted, Inside1.maker === Counted, new D().who(), new E().who(), new E() instanceof A].join());
let sum = 0; for (let i = 0; i < 3000; i++) sum += new A().c + new B().c + new C().c + new D().who().length + (A.has(new B()) ? 100 : 0); lines.push(String(sum));
console.log(lines.join("\n"));
