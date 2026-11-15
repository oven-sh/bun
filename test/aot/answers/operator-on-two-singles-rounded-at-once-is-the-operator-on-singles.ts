// answers: without-library
// # `b[i] = a[i] * b[i]` on Float32Array: two singles are widened, multiplied as doubles, and the product is rounded to a single at once. A double has more than twice the bits of a single and two more, so for + - * / and the square root
// # that is what the operator on singles gives: one instruction for four. A number that is no single (a parameter, 0.1) keeps the operator on doubles; 0.5 is a single.
// # f1 = products, f2 = sums, f3 = byNumber, f4 = byTenth, f5 = byHalf
// # RUN(PRODUCTS): emit f1:Body mechanisms=all
// # PRODUCTS: Float @{{*}} = Mul(
// # RUN(SUMS): emit f2:Body mechanisms=all
// # SUMS: Float @{{*}} = Add(
// # RUN(NUMBER): emit f3:Body mechanisms=all
// # NUMBER-NOT: Float @{{*}} = Mul(
// # RUN(TENTH): emit f4:Body mechanisms=all
// # TENTH-NOT: Float @{{*}} = Mul(
// # RUN(HALF): emit f5:Body mechanisms=all
// # HALF: Float @{{*}} = Mul(
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function products(a: Float32Array, b: Float32Array) { for (let i = 0; i < a.length; i++) b[i] = a[i] * b[i]; return [b[0] + b[1] + b[2] + b[3]]; }
function sums(a: Float32Array, b: Float32Array) { for (let i = 0; i < a.length; i++) b[i] = a[i] + b[i]; return [b[0] + b[1] + b[2] + b[3]]; }
function byNumber(a: Float32Array, d: number) { for (let i = 0; i < a.length; i++) a[i] = a[i] * d; return [a[0] + a[1] + a[2] + a[3]]; }
function byTenth(a: Float32Array) { for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.1; return [a[0] + a[1] + a[2] + a[3]]; }
function byHalf(a: Float32Array) { for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.5; return [a[0] + a[1] + a[2] + a[3]]; }
function view(w: number, x: number, y: number, z: number) { const made = new Float32Array(4); made[0] = w; made[1] = x; made[2] = y; made[3] = z; return made; }
report(products(view(0.1, 16777217, 1e-30, 3), view(0.3, 3, 1e-30, 1 / 3))[0]);
report(sums(view(0.1, 16777216, 1e-45, 3e38), view(0.2, 1, 1e-45, 3e38))[0]);
report(byNumber(view(0.1, 16777217, 1e-30, 3), 1 / 3)[0]);
report(byTenth(view(0.1, 16777217, 1e-30, 3))[0]);
report(byHalf(view(0.1, 16777217, 1e-45, 3))[0]);
report("end");
