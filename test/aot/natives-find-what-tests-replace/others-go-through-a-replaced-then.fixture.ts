import { test } from "bun:test";
function counting<T>(body: () => T): [number, T] {
  const original = Promise.prototype.then; let calls = 0;
  Promise.prototype.then = function (this: any, a: any, b: any) { calls++; return original.call(this, a, b); } as any;
  try { return [calls, body()] as any; } finally { const n = calls; Promise.prototype.then = original; console.log("calls", n); }
}
test("catch", () => { counting(() => { for (let i = 0; i < 300; i++) Promise.reject(i).catch(() => {}); }); });
test("catch on a resolved promise", () => { counting(() => { for (let i = 0; i < 300; i++) Promise.resolve(i).catch(() => {}); }); });
test("finally", () => { counting(() => { for (let i = 0; i < 300; i++) Promise.resolve(i).finally(() => {}); }); });
test("then itself", () => { counting(() => { for (let i = 0; i < 300; i++) Promise.resolve(i).then(() => {}); }); });
test("catch on a new Promise", () => { counting(() => { for (let i = 0; i < 300; i++) new Promise((_, reject) => reject(i)).catch(() => {}); }); });
test("catch on what an async function gives", () => { counting(() => { for (let i = 0; i < 300; i++) (async () => { throw i; })().catch(() => {}); }); });
test("catch on a promise out of unseen code", () => { const unseen = (0, eval)("(x) => x"); counting(() => { for (let i = 0; i < 300; i++) unseen(Promise.reject(i)).catch(() => {}); }); });
test("Promise.all", () => { counting(() => { for (let i = 0; i < 100; i++) Promise.all([Promise.resolve(i), Promise.resolve(i)]); }); });
test("Promise.race", () => { counting(() => { for (let i = 0; i < 100; i++) Promise.race([Promise.resolve(i)]); }); });
test("Promise.allSettled", () => { counting(() => { for (let i = 0; i < 100; i++) Promise.allSettled([Promise.resolve(i)]); }); });
test("await", async () => { const original = Promise.prototype.then; let calls = 0; Promise.prototype.then = function (this: any, a: any, b: any) { calls++; return original.call(this, a, b); } as any; try { for (let i = 0; i < 50; i++) await Promise.resolve(i); } finally { Promise.prototype.then = original; } console.log("calls", calls); });
test("an own then on one promise", async () => { const p: any = Promise.reject(1); let calls = 0; const then = p.then; p.then = function (a: any, b: any) { calls++; return then.call(this, a, b); }; p.catch(() => {}); p.finally(() => {}).catch(() => {}); console.log("calls", calls); });
