import { test } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function makeList(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return [n, n + 1]; }
function peek(list, key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return list[key]; }
function sum(list) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let total = 0; for (let i = 0; i < list.length; i++) total += list[i]; return total; }
Object.defineProperty(Array.prototype, "extra", { get() { this[0] = "text"; return 1; }, configurable: true });
test("a getter laid above", () => {
  const key = unseen("extra");
  let out = "";
  for (let i = 0; i < 300; i++) { const list = makeList(i); peek(list, key); out = String(sum(list)); }
  console.log(out);
  delete Array.prototype.extra;
});
