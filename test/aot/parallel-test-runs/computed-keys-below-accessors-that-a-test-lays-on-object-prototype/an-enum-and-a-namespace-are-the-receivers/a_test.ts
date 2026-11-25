import { test } from "bun:test";
const unseen = (x: any) => [x][JSON.parse("0")];
enum Level { low = 1, high = 2 }
namespace Shelf { export let count = 1; export function read() { return count; } }
function peek(o: any, key: string) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o[key]; }
function all(key: string) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; peek(Level, key); peek(Shelf, key); return [typeof (Level as any).low, typeof Level.high, typeof Shelf.count, typeof Shelf.read()].join("+"); }
test("an accessor above stores into what it is handed", () => {
  Object.defineProperty(Object.prototype, "late", { get() { (this as any).low = "x"; (this as any).count = "x"; return 1; }, set(value) { (this as any).low = "x"; (this as any).count = "x"; }, configurable: true });
  const key = unseen("late");
  let out = [];
  try { for (let i = 0; i < 300; i++) out = [all(key)]; } finally { delete (Object.prototype as any).late; }
  console.log(out.join());
});
