// As a-generator-lets-go-of-a-parameter-and-keeps-the-sum-it-carries-across-its-yields.js, with types, `p1 = null`, closures over two of the sums and a deeper nest of loops.
let order = 0;
let said = "";
const show = (v: unknown): string => (typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v));
function fold(value: unknown): number {
  return typeof value === "number" ? value | 0 : value === null ? 3 : value === undefined ? 5 : 7;
}
function* count(from: number, steps: number): Generator<number, number, unknown> {
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    yield from + i;
    sum = (sum + from + i) | 0;
  }
  return sum;
}
function* k0(
  x: number,
  y: number,
  z: number,
  p0: any,
  p1: any,
  p2: any,
  p3: any,
  p4: any,
  p5: any,
): Generator<number, number, number> {
  let a: number = x,
    b: number = y,
    c: number = z,
    d: number = 2,
    e: number = 2147483600,
    f: number = -2147483640;
  const tick0 = (): void => {
    f += 1;
  };
  const tick1 = (): void => {
    e++;
  };
  {
    const before = c;
    yield d;
    c = c & before;
  }
  for (let i0 = 0; i0 < 33; i0++) {
    e++;
    b = b - (yield* count(-1, 2));
    try {
      yield d;
      a = (a >>> 1) + c;
      yield a;
    } finally {
      order = (Math.imul(order, 31) + d) | 0;
    }
    b = (yield c) & b;
    p1 = null;
    for (let i1 = 0; i1 < 3; i1++) {
      yield (d >>> 1) + 7;
      if ((yield a) > 2) c = c + a;
      tick0();
      try {
        yield d;
        a = a + c;
        yield a;
      } finally {
        order = (Math.imul(order, 31) + d) | 0;
      }
      {
        const before = c;
        yield d;
        c = Math.imul(c, before);
      }
    }
  }
  said = [a, b, c, d, e, f].map(show).join();
  return a + 3 * b + 5 * c + 7 * d + 11 * e + 13 * f;
}
function use0(x: number, y: number, z: number): string {
  const first = k0(x, y, z, [9], [-1], { id: 5 }, 9, { id: 2 }, { id: 5 }),
    second = k0(z, x, y, [9], [-1], { id: 5 }, 9, { id: 2 }, { id: 5 });
  let total = 0,
    sent = 1;
  for (let step = 0; step < 400; step++) {
    const r = first.next(sent),
      s = second.next(total & 7);
    if (r.done || s.done) return total + "=" + r.value + "," + s.value;
    total = (total + r.value - s.value) | 0;
    sent = (s.value & 15) - 3;
  }
  second.return(0);
  first.return(0);
  return total + "~";
}
console.log(
  "k0",
  [
    use0(-2147483648, 2147483647, -2147483647),
    use0(256, -65536, -7),
    use0(100, 12, 0),
    use0(2147483647, -2, -1),
    use0(4294967296, -7, 0.5),
    use0(0, 256, 6),
  ].join(" "),
  order,
  said,
);
export {};
