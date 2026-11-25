// Assignments at the top level that run in another order than they are written in, late, twice or never.
class F { static m() { return 2; } }
for (let i = 0; i < 2; i++) {
  if (i) F.a = i;
  else F.b = i;
}
console.log(F.m(), F.a, F.b, F.c);
globalThis.holder = [F];
const K = globalThis.holder[0];
console.log(Object.keys(F).join(), Reflect.ownKeys(K).join());
class G { static m() { return 3; } }
for (let i = 0; i < 3; i++) {
  switch (i) {
  case 2: G.x = "x"; break;
  case 1: G.y = "y"; break;
  default: G.z = "z"; break;
  }
}
let keys = "";
for (const key in G) keys += key + G[key];
console.log(G.m(), keys, JSON.stringify({ ...G }));
class H { static own = 1; static m() { return this.own; } }
for (let i = 0; i < 3; i++) {
  if (i === 2) H.p = i;
  if (i === 1) { delete H.own; H.q = i; }
  if (i === 0) H.r = i;
}
console.log(H.m(), Object.keys(H).join());
H.own = "again";
console.log(H.m(), Object.keys(H).join());
class I { }
for (let i = 0; i < 4; i++) {
  if (i === 3) I.first = i;
  if (i === 1) I.second = i;
  if (i === 2) delete I.second;
  if (i === 2) I.third = i;
  if (i === 3) I.second = -i;
}
console.log(Object.entries(I).join());
