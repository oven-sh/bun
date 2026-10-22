// Assorted: literal handed to a callee whose inner functions capture it. It prints what plain Bun prints.
function outer(texts: readonly string[], n: number): number {
  let seg = 0;
  const last = texts.length - 1;
  for (let i = 0; i < n; i++) add(i % (last + 1));
  return seg;
  function get(i: number) { return i < last ? texts[i] : "end"; }
  function add(s: number) { seg += get(s).length; }
}
function caller(v: string, n: number) { return outer([v], n); }
let sum = 0;
for (let i = 0; i < 1000; i++) sum += caller("a" + i, 3);
console.log(sum);
