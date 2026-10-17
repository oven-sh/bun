import { nextTurns } from "../host.ts";
function positive(text, fallback) {
  const value = Number(text);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
function sumOf(id, page, limit) {
  return Number(id) + positive(page, 1) + Math.min(positive(limit, 20), 100);
}
function bench(params, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += sumOf(params.get("id"), params.get("page"), params.get("limit"));
  return s;
}
const subject = new URLSearchParams("id=7&page=25&limit=10");
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(subject, n);
console.log(check);
