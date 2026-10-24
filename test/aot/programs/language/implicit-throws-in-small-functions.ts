function readEarly(): number {
  return early;
}
function addEarly(a: number, b: number, c: number): number {
  return a + b + c + early;
}
function scaleEarly(factor: number): number {
  return factor * 1.5 + early;
}
function told(f: () => number): string {
  try {
    return String(f());
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message + " " + (error instanceof ReferenceError);
  }
}
const readers: (() => number)[] = [readEarly, () => addEarly(1, 2, 3), () => scaleEarly(4)];
function sweep(rounds: number): string {
  let a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, x = 0.5, y = 1.25, failures = 0;
  for (let i = 0; i < rounds; i++) {
    try {
      a += readers[i % 3]!();
    } catch {
      failures++;
    }
    b += a & 15;
    c += b & 7;
    d ^= c;
    e += d & 3;
    f += e & 1;
    x += y * 0.25;
    y += (f & 1) * 0.5;
  }
  return [a, b, c, d, e, f, x, y, failures].join();
}
function deep(depth: number): number {
  return depth === 0 ? readEarly() : deep(depth - 1) + 1;
}
console.log(readers.map(told).join(" | "));
console.log(sweep(3000));
console.log(told(() => deep(50)));
let early = 10;
console.log(readers.map(told).join(" | "));
console.log(sweep(3000));
console.log(told(() => deep(50)));
