import { test } from "bun:test";
function ask(list: Promise<number>[]) { let n = 0; for (const p of list) { p.finally(() => {}); n++; } return n; }
const made: Promise<number>[] = []; for (let i = 0; i < 3; i++) made.push(Promise.resolve(i));
test("finally-calls-then", () => {
  let calls = 0; let seen: unknown = "";
  const real = Promise.prototype.then; Promise.prototype.then = function (this: any, a: any, b: any) { calls++; return real.call(this, a, b); } as any;
  try {
    for (let i = 0; i < 300; i++) seen = ask(made);
  } finally {
    Promise.prototype.then = real;
  }
  console.log(String(seen), calls);
});
