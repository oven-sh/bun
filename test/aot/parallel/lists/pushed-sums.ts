const name = (x: unknown) => (Object.is(x, -0) ? "-0" : String(x));
function machine(code: string, given: any[], stack: number[]): string {
  for (let i = 0; i < given.length; i++) {
    stack.push(given[i]);
    stack.push(given[(i * 3 + 1) % given.length]);
    const b = stack.pop()!;
    const a = stack.pop()!;
    switch (code) {
      case "+": stack.push(a + b); break;
      case "-": stack.push(a - b); break;
      case "*": stack.push(a * b); break;
      case "3*": stack.push(3 * a); break;
      case "a*a": stack.push(a * a); break;
    }
  }
  return stack.map(name).join(" ");
}
const rows: any[][] = [
  [0, 1, -1, 7, -9, 12],
  [0, -0, -3, 0, 5, -7],
  [2147483647, -2147483648, 65536, 46341, -46341, 1],
  [0.5, -2.25, 3, 1e10, 7, 0.1],
  [NaN, Infinity, -Infinity, 0, 1, 5e-324],
  [1, undefined, 3, , 5, 6],
  [9007199254740991, 4503599627370497, 3, -9007199254740992, 2, 1e308],
];
for (const row of rows) for (const code of ["+", "-", "*", "3*", "a*a"]) for (const start of [[], [1], [0.5]]) console.log(machine(code, row, start.slice()));
