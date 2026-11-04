const N = 300000;
function ring(name, start) { let answer; try { answer = start(); } catch (e) { answer = e.constructor.name; } console.log(name, String(answer)); }
function a1(n, acc) { return n === 0 ? acc : step1(n - 1, acc + 1); } function step1() { return Reflect.apply(a1, null, arguments); }
function a2(n, acc) { return n === 0 ? acc : step2(n - 1, acc + 1); } function step2() { return a2.apply(null, arguments); }
function a3(n, acc) { "use strict"; return n === 0 ? acc : step3(n - 1, acc + 1); } function step3() { "use strict"; return Reflect.apply(a3, undefined, arguments); }
function a4(n, acc) { return n === 0 ? acc : step4(n - 1, acc + 1); } function step4(...rest) { return Reflect.apply(a4, null, rest); }
function a5(n, acc) { return n === 0 ? acc : a5(...new Set([n - 1, acc + 1.5])); }
function a6(n, acc) { return n === 0 ? acc : a6(...[n - 1, , acc + 1].filter((x) => x !== undefined)); }
function a7(n, acc) { return n === 0 ? acc : Reflect.apply(a7, null, [n - 1, acc + 0.5]); }
function a8(n, acc) { return n === 0 ? acc : Reflect.apply(a8, null, [n - 1, "t"]); }
function a9(n, acc) { return n === 0 ? acc : Reflect.apply(a9, null, Array.of(n - 1, acc + 1)); }
function a10(n, acc) { return n === 0 ? acc : Reflect.apply(a10, null, new Array(n - 1, acc + 1)); }
function a11(n, acc) { const l = [n - 1]; l.push(acc + 1); return n === 0 ? acc : Reflect.apply(a11, null, l); }
function a12(n, acc) { return n === 0 ? acc : Reflect.apply(a12, null, [n - 1, acc + 1].concat([])); }
function a13(n, acc) { return n === 0 ? acc : Reflect.apply(a13, null, Object.seal([n - 1, acc + 1])); }
function a14(n, acc) { return n === 0 ? acc : Reflect.apply(a14, null, "x".repeat(0).split("").concat([n - 1, acc + 1])); }
function a15(n, acc) { return n === 0 ? acc : Function.prototype.apply.call(a15, null, { length: 2, 0: n - 1, 1: acc + 1 }); }
function a16(n, acc) { return n === 0 ? acc : Reflect.apply(a16, null, [n - 1, acc + 1, undefined]); }
function a17(n, acc) { return n === 0 ? acc : Reflect.apply(a17, null, [n - 1, , ]); }
ring("arguments-Reflect", () => a1(N, 0)); ring("arguments-apply", () => a2(N, 0)); ring("strict-arguments-Reflect", () => a3(N, 0)); ring("rest-Reflect", () => a4(N, 0)); ring("spread-of-a-Set", () => a5(N, 0)); ring("spread-filtered", () => a6(N, 0)); ring("doubles", () => a7(N, 0)); ring("mixed", () => a8(N, 0)); ring("Array.of", () => a9(N, 0)); ring("new Array", () => a10(N, 0)); ring("pushed", () => a11(N, 0)); ring("concat", () => a12(N, 0)); ring("sealed", () => a13(N, 0)); ring("split-concat", () => a14(N, 0)); ring("apply.call-like", () => a15(N, 0)); ring("undefined-inside", () => a16(N, 0)); ring("trailing-hole", () => a17(N, 0));
