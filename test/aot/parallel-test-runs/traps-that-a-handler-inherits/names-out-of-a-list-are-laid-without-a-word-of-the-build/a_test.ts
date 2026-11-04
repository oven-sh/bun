// The names come out of a list that the file writes, so the build has read each and opened it. It says nothing at the store, which throws nothing.
import { test } from "bun:test";
type Size = { width: number; height: number };
function makeSize(): Size { return { width: 1, height: 2 }; }
function fill(size: Size, count: number): void { for (let i = 0; i < count; i++) size.width = i; }
test("both traps of definitions, one after the other", () => {
  for (const trap of ["defineProperty", "getOwnPropertyDescriptor"]) {
    let calls = 0;
    const target = makeSize();
    (Object.prototype as any)[trap] = function (target: object, key: PropertyKey, descriptor?: PropertyDescriptor) { calls++; return (Reflect as any)[trap](target, key, descriptor); };
    try { fill(new Proxy(target, { label: "plain" } as ProxyHandler<Size>), 300); } finally { delete (Object.prototype as any)[trap]; }
    console.log(trap, calls, target.width);
  }
});
