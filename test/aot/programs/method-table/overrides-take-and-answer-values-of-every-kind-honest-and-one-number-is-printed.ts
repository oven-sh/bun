// An honest program about what goes through a call: overrides in one family take and answer integers, fractions, NaN, minus zero, large numbers, texts, booleans, objects or null, bigints and nothing at all, and one method takes twelve arguments. One number is printed.
class Pipe {
  real(x: number): number {
    return x;
  }
  text(s: string): string {
    return s;
  }
  flag(b: boolean): boolean {
    return b;
  }
  next(pipe: Pipe | null): Pipe | null {
    return pipe;
  }
  big(n: bigint): bigint {
    return n;
  }
  nothing(): void {}
  twelve(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number): number {
    return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + k * 11 + l * 12;
  }
}
class Bent extends Pipe {
  calls = 0;
  real(x: number): number {
    return x / 2;
  }
  text(s: string): string {
    return s + s;
  }
  flag(b: boolean): boolean {
    return !b;
  }
  next(): Pipe | null {
    return null;
  }
  big(n: bigint): bigint {
    return n * n;
  }
  nothing(): void {
    this.calls++;
  }
  twelve(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number): number {
    return l + k * 2 + j * 3 + i * 4 + h * 5 + g * 6 + f * 7 + e * 8 + d * 9 + c * 10 + b * 11 + a * 12;
  }
}
class Odd extends Pipe {
  real(x: number): number {
    return x === 0 ? -0 : x > 1000 ? NaN : x * 1e15;
  }
  next(): Pipe | null {
    return this;
  }
}

function through(pipe: Pipe): number {
  let sum = 0;
  for (const x of [0, 1, 3, 2.5, -7, 2000, 2147483647]) {
    const real = pipe.real(x);
    sum += Number.isNaN(real) ? 13 : Object.is(real, -0) ? 17 : real % 1009;
  }
  sum += pipe.text("ab").length * 10 + pipe.text("").length;
  sum += (pipe.flag(true) ? 100 : 200) + (pipe.flag(false) ? 1000 : 2000);
  const next = pipe.next(pipe);
  sum += next === null ? 10000 : next === pipe ? 20000 : 30000;
  sum += Number(pipe.big(12345678901n) % 1009n);
  sum += pipe.nothing() === undefined ? 100000 : 200000;
  sum += pipe.twelve(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12.5);
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const bent = new Bent();
const pipes: Pipe[] = [new Pipe(), bent, new Odd()];
for (const pipe of pipes) note(through(pipe));
let sum = 0;
for (let round = 0; round < 1000; round++) for (const pipe of pipes) sum = (sum + through(pipe)) % 1000003;
note(sum);
note(bent.calls);
console.log(checksum);

export {};
