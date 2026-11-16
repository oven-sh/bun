import { test } from "bun:test";
function caught(list: Promise<number>[]) {
  const out: Promise<number>[] = [];
  for (const p of list) out.push(p.catch(() => -1));
  return out.length;
}
test("catch calls the then that it finds", () => {
  let calls = 0;
  const list: Promise<number>[] = [];
  for (let i = 0; i < 300; i++) list.push(Promise.resolve(i));
  const real = Promise.prototype.then;
  Promise.prototype.then = function (this: any, a: any, b: any) { calls++; return real.call(this, a, b); } as any;
  try {
    caught(list);
  } finally {
    Promise.prototype.then = real;
  }
  console.log(calls);
});
