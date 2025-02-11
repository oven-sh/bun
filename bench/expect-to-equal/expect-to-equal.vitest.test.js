import { expect, test } from "vitest";

const N = parseInt(process.env.RUN_COUNT || "10000", 10);
if (!Number.isSafeInteger(N)) {
  throw new Error("Invalid RUN_COUNT");
}

const label = "expect().toEqual() x " + N;

test(label, () => {
  console.time(label);
  for (let runsLeft = N; runsLeft > 0; runsLeft--) {
    expect("hello").toEqual("hello");
    expect(123).toEqual(123);

    expect({ a: 1, b: 2 }).toEqual({ b: 2, a: 1 });
    expect([1, 2, 3]).toEqual([1, 2, 3]);
    expect({ a: 1, b: 2 }).not.toEqual({ b: 2, a: 1, c: 3 });
    expect([1, 2, 3]).not.toEqual([1, 2, 3, 4]);
    expect({ a: 1, b: 2, c: 3 }).not.toEqual({ a: 1, b: 2 });
    expect([1, 2, 3, 4]).not.toEqual([1, 2, 3]);

    let a = [{ a: 1 }, { b: 2, c: 3, d: 4 }, { e: 5, f: 6 }];
    let b = [{ a: 1 }, { b: 2, c: 3, d: 4 }, { e: 5, f: 6 }];
    expect(a).toEqual(b);
    expect(b).toEqual(a);
    a[0].a = 2;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    let c = { [Symbol("test")]: 1 };
    let d = { [Symbol("test")]: 1 };
    expect(c).not.toEqual(d);
    expect(d).not.toEqual(c);

    a = { a: 1, b: 2, c: 3 };
    b = { a: 1, b: 2 };
    expect(a).not.toEqual(b);
  }
  console.timeEnd(label);
});
