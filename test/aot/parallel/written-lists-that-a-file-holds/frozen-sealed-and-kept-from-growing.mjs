const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const T0 = [3, 10, 17, 24, 31, 38, 45, 52];
function sum0() { let s = 0; for (let i = 0; i < T0.length; i++) s += T0[i]; return s; }
const T1 = [3, 10, 17, 24, 31, 38, 45, 52];
function sum1() { let s = 0; for (let i = 0; i < T1.length; i++) s += T1[i]; return s; }
const T2 = [3, 10, 17, 24, 31, 38, 45, 52];
function sum2() { let s = 0; for (let i = 0; i < T2.length; i++) s += T2[i]; return s; }
say(unseen(sum0)(), unseen(sum1)(), unseen(sum2)()); unseen(Object).freeze(unseen(T0)); unseen(Object).seal(unseen(T1)); unseen(Object).preventExtensions(unseen(T2)); say(unseen(sum0)(), unseen(sum1)(), unseen(sum2)(), Object.isFrozen(T0));
