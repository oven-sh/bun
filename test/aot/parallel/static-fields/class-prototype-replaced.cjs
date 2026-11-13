// The prototype of a class object is replaced before or between its assignments.
const log = [];
class C { static m() { return 1; } }
for (let i = 0; i < 4; i++) {
  console.log(i, C.m?.(), String(C.Use), String(C.Def), Object.keys(C).join(), log.join());
  if (i === 0) C.first = 0;
  if (i === 1) Object.setPrototypeOf(C, { set Use(value) { log.push(value); }, get Def() { return "got"; } });
  if (i === 2) { C.Use = 5; try { C.Def = 6; } catch { } }
}
class D { static m() { return 1; } }
Object.setPrototypeOf(D, { set Use(value) { log.push("D" + value); } });
D.Use = 1; D.Def = 2;
console.log(D.m(), String(D.Use), D.Def, Object.keys(D).join(), log.join());
class E { static m() { return 1; } }
E.a = 1;
Object.preventExtensions(E);
for (let i = 0; i < 2; i++) { E.b = 2; E.a = 3; }
console.log(E.m(), E.a, E.b, Object.keys(E).join());
class F { static m() { return 1; } }
F.a = 1; F.m();
Object.freeze(F);
for (let i = 0; i < 2; i++) { F.b = 2; F.a = 3; }
console.log(F.m(), F.a, F.b, Object.keys(F).join(), Object.isFrozen(F));
class G { static m() { return 1; } }
G.a = 1; G.m();
Object.defineProperty(G, "b", { value: 4, configurable: true });
for (let i = 0; i < 2; i++) G.b = 2;
console.log(G.a, G.b, Object.keys(G).join(), Object.getOwnPropertyNames(G).join());
class H { static m() { return 1; } static get b() { return "getter"; } }
H.a = 1; H.m();
for (let i = 0; i < 2; i++) H.b = 2;
console.log(H.a, H.b, Object.keys(H).join());
