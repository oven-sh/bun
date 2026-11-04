// a function with one parameter jumps to one with fourteen, through another with one, from callers that hold values across the call
function wide(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number): number {
  return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + k * 11 + l * 12 + m * 13 + n * 14;
}
function narrow(a: number): number {
  return wide(a, a + 1, a + 2, a + 3, a + 4, a + 5, a + 6, a + 7, a + 8, a + 9, a + 10, a + 11, a + 12, a + 13);
}
function first(a: number): number {
  return narrow(a + 1);
}
function byValue(f: (a: number) => number, a: number): number {
  return f(a);
}
function deed(a: number) {
  const before = a * 3;
  const one = first(a);
  const two = byValue(first, a + 1);
  const three = byValue(narrow, a + 2);
  return [before, one, two, three, before + one + two + three].join();
}
console.log(deed(1));
for (let i = 0; i < 5; i++) console.log(deed(i + 0.5));
console.log(deed(2));
