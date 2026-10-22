// A property read that repeats an earlier one, with nothing in between that could change the result, reuses its value.
// IR= 1 straight PropGet v[0-9]+ name="alpha"
// IR= 1 chain PropGet v[0-9]+ name="beta"
// IR= 1 arms PropGet v[0-9]+ name="gamma"
// IR= 1 otherStore PropGet v[0-9]+ name="delta"
// IR= 1 aroundLoop PropGet v[0-9]+ name="epsilon"
// IR= 1 throughTests PropGet v[0-9]+ name="zeta"
// IR= 1 moduleVariable GetModuleVariable
// IR= 1 pureBuiltin PropGet v[0-9]+ name="eta"
// IR= 2 twoReceivers PropGet v[0-9]+ name="theta"
// IR= 6 fixedAcrossCall GetEnvironmentField
// IR= 2 changingAcrossCall GetModuleVariable
declare const console: any;
interface T { alpha: number; beta: number; gamma: number; delta: number; epsilon: number; zeta: number; eta: number; theta: number; other: number; next: T | undefined }
let total = 7;
function straight(t: T) { return t.alpha * 3 + t.alpha * 5 + t.alpha; }
function chain(t: T) { return t.beta & 1 ? 10 : t.beta & 2 ? 20 : t.beta & 4 ? 30 : t.beta & 8 ? 40 : t.beta; }
function arms(t: T, flag: boolean) { let r = t.gamma; if (flag) r += t.gamma * 2; else r -= t.gamma * 3; return r + t.gamma; }
function otherStore(t: T, u: T) { const a = t.delta; u.other = a + 1; return a + t.delta; }
function aroundLoop(t: T, n: number) { let r = t.epsilon; for (let i = 0; i < n; i++) r += t.epsilon + i; return r + t.epsilon; }
function throughTests(t: T | undefined) { if (!t) return 0; const a = t.zeta; const u: T = t; return a + u.zeta + t!.zeta; }
function moduleVariable(k: number) { return total * k + total + (k > 2 ? total : -total); }
function pureBuiltin(t: T, x: number) { const a = t.eta; const f = Math.floor(x) + Math.abs(x); return a + f + t.eta; }
function twoReceivers(t: T, u: T) { return t.theta + u.theta + t.theta + u.theta; }
// Constants of an environment keep their value across a call that is not looked into (six reads in the function; its general entry holds no copy); a variable does not.
function recurse(n: number): number { return n <= 0 ? 0 : 1 + recurse(n - 1); }
function makeFixed(k: number) {
    const c1 = k + 1, c2 = k + 2, c3 = k + 3, c4 = k + 4, c5 = k + 5, c6 = k + 6;
    return function fixedAcrossCall(j: number) { const a = c1 + c2 + c3 + c4 + c5 + c6; const b = recurse(j); return a + b + c1 + c2 + c3 + c4 + c5 + c6; };
}
const fixedAcrossCall = makeFixed(1);
function changingAcrossCall(k: number) { const a = total; const b = recurse(k); return a + b + total; }
const one: T = { alpha: 1, beta: 2, gamma: 3, delta: 4, epsilon: 5, zeta: 6, eta: 7, theta: 8, other: 9, next: undefined };
const two: T = { alpha: 11, beta: 12, gamma: 13, delta: 14, epsilon: 15, zeta: 16, eta: 17, theta: 18, other: 19, next: one };
total = Number("7");
let s = 0;
for (let i = 0; i < 2_000_000; i++) {
    if (i === 1_000_000) total = 9;
    const t = i & 1 ? one : two;
    s += straight(t) + chain(t) + arms(t, (i & 2) === 0) + otherStore(t, two) + aroundLoop(t, i & 3) + throughTests(t) + moduleVariable(i & 7) + pureBuiltin(t, i / 3) + twoReceivers(t, one) + fixedAcrossCall(i & 1) + changingAcrossCall(i & 1);
}
// Called once outside any loop too: top-level code that runs once takes nothing in, so the function keeps a body for the expectations to look at.
s += straight(one) + chain(one) + arms(one, true) + otherStore(one, two) + aroundLoop(one, 1) + throughTests(one) + moduleVariable(1) + pureBuiltin(one, 1.5) + twoReceivers(one, two) + fixedAcrossCall(1) + changingAcrossCall(1);
console.log(s);
export {};
