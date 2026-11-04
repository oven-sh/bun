// A loop stores a field of another object under a test, then a field of its holder, then that field again behind instanceof; the holder is of one class in one call and of another in the next.
class Q { constructor() { this.n = 0; } }
class P { constructor() { this.n = 0; } }
function f(holder, other, j, turns) {
  for (let i = 0; i < turns; i++) {
    if (j) other.n = j;
    holder.n = (holder.n + 1) | 0;
    if (holder instanceof Q) holder.n = (holder.n + 1) | 0;
  }
  return [holder.n, other.n];
}
const A = JSON.parse(process.argv[2] ?? '[1,"a"]');
const out = [];
for (let t = 0; t < 3; t++) { out.push(f(new Q(), new P(), A[0], 3)); out.push(f(new P(), new Q(), A[1], 3)); }
console.log(JSON.stringify(out));
