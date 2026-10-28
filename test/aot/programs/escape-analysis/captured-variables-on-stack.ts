// Captured variables can live on the stack when the inner functions that capture them are only called directly.
type Node = { value: string; next: Node | null };
function outer(n: number): string { //! frame
  let total = 0;
  let label = "a";
  let head: Node | null = null;
  const names: string[] = [];
  function walk(d: number): void {
    if (d <= 0) return;
    total += d;
    label = label + d;
    head = { value: "v" + d, next: head };
    names.push(label);
    walk(d - 1);
  }
  walk(n);
  let seen = "";
  for (let p = head as Node | null; p; p = p.next) seen += p.value;
  return total + ":" + names.length + ":" + label.length + ":" + seen.length + ":" + names[names.length - 1].length;
}
function inLoop(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) { //! frame
    const tag = "t" + i;
    let text = "s";
    const list: string[] = [];
    const fill = function fill(k: number): void {
      if (k <= 0) return;
      list.push(tag + k);
      text += tag;
      fill(k - 1);
    };
    fill(3);
    sum += list.length + text.length + tag.length + list[2].length;
  }
  return sum;
}
function again(depth: number): number { //! frame
  let mine = "m" + depth;
  let below = 0;
  function down(k: number): void {
    if (k > 0) { mine += k; down(k - 1); return; }
    if (depth > 0) below = again(depth - 1);
  }
  down(2);
  return mine.length + below;
}
function caught(n: number): string { //! frame
  let trail = "";
  function step(k: number): void {
    trail += "k" + k;
    if (k === 0) throw new Error("end " + trail.length);
    step(k - 1);
  }
  try { step(n); } catch (e) { trail += (e as Error).message; }
  try { step(1); } catch (e) { trail += "|" + (e as Error).message; }
  return trail;
}
function thrower(n: number): number { //! frame
  let count = 0;
  function step(k: number): void {
    count++;
    if (k === 0) throw new Error("out " + count);
    step(k - 1);
  }
  step(n);
  return count;
}
let out = "";
for (let i = 0; i < 300; i++) {
  const a = outer(i % 40 + 1), b = inLoop(i % 7), c = again(i % 9), d = caught(i % 11);
  let e = "";
  try { thrower(i % 5); } catch (x) { e = (x as Error).message; }
  if (i % 50 === 0) out += a + "|" + b + "|" + c + "|" + d.length + "|" + e + "\n";
}
console.log(out);
