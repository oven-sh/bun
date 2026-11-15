import * as outer from "./outer.mjs";
let work = 0;
async function nothing() { for (let i = 0; i < 2; i++) work = (work + i) | 0; return 0; }
function chain(n) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return nothing().then(function () { for (let i = 0; i < 2; i++) work = (work + i) | 0; return n; });
}
function kind(v) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof v; }
function own(v) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return v.own; }
async function main() {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = await chain(outer.inner);
  console.log(kind(got), own(got));
}
main();
