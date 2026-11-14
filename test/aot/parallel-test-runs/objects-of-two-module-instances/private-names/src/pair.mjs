let first = null;
let last = null;
const name = error => error.constructor.name;
export function keep(vault) { if (first === null) first = vault; last = vault; }
export function adds(n) { if (first === null || last === null) return 0; let sum = 0; for (let i = 0; i < n; i++) sum += first.add(i) + last.add(i) * 3 + first.secret + last.secret * 5; return sum; }
export function own() { if (first === null || last === null) return ""; return [first.add(1), last.add(1), first.secret, last.secret, first.has(first), last.has(last), first.peek(first), last.peek(last)].join(" "); }
export function crossed() {
  if (first === null || last === null) return "";
  const out = [first.has(last), last.has(first)];
  try { out.push(first.peek(last)); } catch (error) { out.push(name(error)); }
  try { out.push(last.peek(first)); } catch (error) { out.push(name(error)); }
  return out.join(" ");
}
export function stored(n) { if (first === null || last === null) return 0; for (let i = 0; i < n; i++) { first.secret = i; last.secret = i * 2; } return first.secret * 1000 + last.secret; }
export function extras() { if (first === null || last === null) return ""; const out = []; for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) { try { out.push((a ? last : first).extra(b ? last : first)); } catch (error) { out.push(name(error)); } } return out.join(" "); }
export function hooked(n, act) { if (first === null || last === null) return ""; const out = []; for (let i = 0; i < n; i++) { out.push(first.add(i), first.secret); act(i); out.push(last.add(i), last.has(first), first.has(last), last.secret); } return out.join(" "); }
