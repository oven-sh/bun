const kept = [];
function make(list) {
  for (const x of list) {
    let seen = x;
    kept.push(() => seen++);
  }
  let count = 0;
  return () => count++;
}
let total = 0;
for (let k = 0; k < 300; k++) { const next = make([1, 2]); next(); total += next(); }
console.log(total, kept.length);
