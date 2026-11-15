import { test } from "bun:test";
function makeList(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return [n, n + 1]; }
function use(list) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "a".concat(list); }
function sum(list) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let total = 0; for (let i = 0; i < list.length; i++) total += list[i]; return total; }
test("Array.prototype.join replaced: a row converts a list", () => {
  const original = Array.prototype.join; Array.prototype.join = function () { this[0] = "text"; return "1"; };
  let kind = "", out;
  for (let i = 0; i < 300; i++) { const list = makeList(i); out = use(list); kind = String(sum(list)); }
  Array.prototype.join = original;
  console.log(String(out), kind);
});
