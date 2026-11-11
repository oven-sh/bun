import * as space from "./barrel.mjs";
let work = 0;
async function nothing() { for (let i = 0; i < 2; i++) work = (work + i) | 0; return 0; }
function chain(n) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return nothing().then(function () { for (let i = 0; i < 2; i++) work = (work + i) | 0; return n; });
}
function says(v) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return v ? "yes" : "no"; }
async function main() { for (let i = 0; i < 2; i++) work = (work + i) | 0; console.log(says(await chain(space))); }
main();
