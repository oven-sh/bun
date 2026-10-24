// Bindings of class and function declarations are assigned again, here and in the module that exports them, and every user sees the new value; the inner binding of a class stays.
import Def, { Ex, fn, live, swap, inside } from "./exporter";
import * as ns from "./exporter";
function show(label: string, f: () => unknown) {
    try { console.log(label, JSON.stringify(f())); } catch (e) { console.log(label, "threw", (e as Error).constructor.name, (e as Error).message); }
}
class A { m() { return "A"; } static s = 1; x = "ax"; }
class B { m() { return "B"; } static s = 2; y = "by"; }
function useA() { return [new A().m(), A.s, A.name, Object.keys(new A()).join()]; }
show("class before", useA);
// @ts-ignore
A = B;
show("class reassigned", useA);
show("instanceof after", () => [new A() instanceof B, new B() instanceof A]);
class C { static make() { return new C(); } who() { return "C"; } }
const keepC = C;
// @ts-ignore
C = class { who() { return "replaced"; } };
show("inner binding stays", () => [keepC.make().who(), new C().who()]);
class D extends A { }
show("extends reassigned", () => [new D().m(), Object.getPrototypeOf(D) === B]);
show("const inner binding", () => { class E { static f() { /* @ts-ignore */ (E as any) = 1; } } try { E.f(); } catch (e) { return (e as Error).constructor.name; } return "no throw"; });
show("class expression name", () => { const F = class G { static f() { /* @ts-ignore */ (G as any) = 1; } }; try { F.f(); } catch (e) { return (e as Error).constructor.name; } return "no throw"; });
show("function expression name", () => { const f = function g() { try { /* @ts-ignore */ (g as any) = 1; } catch (e) { return (e as Error).constructor.name; } return typeof g; }; return f(); });
function h() { return 1; }
function callH() { return h(); }
show("function before", callH);
// @ts-ignore
h = () => 2;
show("function reassigned", callH);
show("imports before", () => [new Ex().m(), Ex.s, fn(), new Def().m(), live, inside(), new ns.Ex().m(), ns.fn(), ns.live]);
swap();
show("imports after", () => [new Ex().m(), Ex.s, fn(), new Def().m(), live, inside(), new ns.Ex().m(), ns.fn(), ns.live, new ns.default().m()]);
let K = class { v = 1; }; const k1 = new K(); K = class { v = 2; w = 3; } as any; show("let class", () => [k1, new K()]);
var V = class { v = 1; }; function mkV() { return new V(); } show("var class", () => { const a = mkV(); V = class { v = 5; } as any; return [a, mkV()]; });
show("class in loop", () => { const made: any[] = []; for (let i = 0; i < 3; i++) { class L { static n = i; i = i; } made.push(L); } return [made.map(m => m.n), made[0] === made[1], new made[2]().i, new made[0]() instanceof made[1]]; });
show("conditional class", () => { const pick = (c: boolean) => { class X { t = "x"; } class Y { t = "y"; u = 1; } let Z: any = X; if (c) Z = Y; return new Z(); }; return [pick(true), pick(false)]; });
