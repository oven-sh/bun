import { test } from "bun:test";
test("catch goes through a replaced then", () => {
  const original = Promise.prototype.then;
  let calls = 0;
  Promise.prototype.then = function (a: any, b: any) { calls++; return original.call(this, a, b); } as any;
  try {
    for (let i = 0; i < 300; i++) Promise.reject(i).catch(() => {});
  } finally { Promise.prototype.then = original; }
  console.log(calls);
});
