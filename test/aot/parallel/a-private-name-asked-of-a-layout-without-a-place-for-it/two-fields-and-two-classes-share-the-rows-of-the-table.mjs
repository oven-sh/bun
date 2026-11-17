class P { #a = 1; #b = 2; #c = 3; static a(o) { return #a in o; } static b(o) { return #b in o; } static c(o) { return #c in o; } }
class R { #a = 1; #b = 2; static a(o) { return #a in o; } static b(o) { return #b in o; } }
const kinds = []; for (let i = 0; i < 70; i++) kinds.push(new (class { ["k" + i] = i; })());
kinds.push(new P(), new R());
let bits = 0n, at = 0n; for (let turn = 0; turn < 2; turn++) for (const o of kinds) for (const ask of [P.a, P.b, P.c, R.a, R.b]) { if (ask(o)) bits |= 1n << at; at++; }
console.log(bits.toString(16));
