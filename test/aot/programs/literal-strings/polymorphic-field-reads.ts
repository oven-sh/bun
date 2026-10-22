// Fields of unions of string literals, at other places in each of many classes, are read by name by code that knows nothing of the classes.
import { kindOf, kindsOf, lengthsOf, callKind, countOf } from "./polymorphic-field-reads-helper.js";
type Kind = "circle" | "square" | "ring" | "";
type Mode = "on" | "off";
class A { constructor(public kind: Kind) {} }
class B { constructor(public id: number, public kind: Kind) {} }
class C { constructor(public id: number, public name: string, public kind: Kind) {} }
class D { constructor(public mode: Mode, public kind: Kind | undefined) {} }
class E { constructor(public mode: Mode, public id: number, public kind: Kind | null) {} }
class F { kind?: Kind; constructor(public mode: Mode) {} }
class G { constructor(public a: number, public b: number, public c: number, public d: number, public kind: Kind, public mode: Mode) {} }
class H { constructor(public kind: string) {} }
interface Tagged { kind: Kind; weight: number }
const kinds: Kind[] = ["circle", "square", "ring", ""];
const fromOutside: any[] = JSON.parse('[{"kind":"ring","weight":1},{"kind":"nobody knows this one","weight":2}]');
function make(i: number): unknown[] {
    const kind = kinds[i % 4];
    const f = new F("off");
    if (i % 3) f.kind = kind;
    const literal: Tagged = { kind, weight: i };
    const stranger: Tagged = { kind: "", weight: i };
    (stranger as any).kind = fromOutside[1].kind;
    return [new A(kind), new B(i, kind), new C(i, "n" + i, kind), new D("on", i % 2 ? kind : undefined), new E("off", i, i % 2 ? null : kind), f, new G(1, 2, 3, 4, kind, "on"), new H("free " + i), literal, stranger, { kind: "plain " + kind }, fromOutside[i % 2]];
}
const all: unknown[] = [];
for (let i = 0; i < 12; i++) all.push(...make(i));
let digest = 0;
for (let round = 0; round < 200; round++) {
    const text = kindsOf(all);
    digest = (digest * 31 + text.length + lengthsOf(all)) % 1000003;
    if (round % 50 === 0) console.log(round, text.slice(0, 150), countOf(all, "ring"), countOf(all, ""), countOf(all, undefined), countOf(all, null));
}
console.log(digest, all.map(kindOf).slice(0, 24).join("|"));
console.log(all.slice(0, 12).map(callKind).join("|"));
