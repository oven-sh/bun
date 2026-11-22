// A function that took few arguments leaves by a call that passes many: nine to fourteen. Two such functions call each other in tail position a million times: the stack does not grow. An error thrown at the bottom comes up through it all.
"use strict";
function nine(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number): number {
  if (a <= 0) return b + c * 2 + d * 3 + e * 4 + f * 5 + g * 6 + h * 7 + i * 8;
  return few(a - 1, b + i);
}
function few(left: number, sum: number): number {
  return left % 3 ? nine(left, sum % 1000003, 1, 2, 3, 4, 5, 6, 7) : fourteen(left, sum % 1000003, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
}
function fourteen(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number): number {
  if (a <= 0) return b + c + d + e + f + g + h + i + j + k + l + m + n * 100;
  return few(a - 1, b + n + c);
}
function throwsAtTheBottom(left: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number): number {
  if (!left) throw new RangeError("bottom " + (a + b + c + d + e + f + g + h + i));
  return starts(left - 1);
}
function starts(left: number): number { return throwsAtTheBottom(left, 1, 2, 3, 4, 5, 6, 7, 8, left); }
const byValue = [few, (left: number, sum: number) => few(left, sum + 1)];
const said: string[] = [];
for (const count of [0, 1, 2, 3, 10, 1000, 1000000]) for (const called of byValue) said.push(String(called(count, 5)));
for (const count of [0, 1, 7, 50000]) { try { said.push(String(starts(count))); } catch (error) { said.push((error as Error).constructor.name + " " + (error as Error).message); } }
console.log(said.join("\n"));
