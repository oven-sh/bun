// Checks that BranchID.separatedFrom equals: some ancestor-or-self x of a and y of b have the same base and differ.
class BranchID {
  constructor(parent, base) { this.parent = parent; this.base = base ?? this; }
  separatedFrom(other) {
    if (this.base === other.base && this !== other) return true;
    if (other.parent && this.separatedFrom(other.parent)) return true;
    return this.parent?.separatedFrom(other) ?? false;
  }
  child() { return new BranchID(this, null); }
  sibling() { return new BranchID(this.parent, this.base); }
}
function iterative(a, b) {
  for (let x = a; x; x = x.parent) for (let y = b; y; y = y.parent) if (x.base === y.base && x !== y) return true;
  return false;
}
// With a map from base to node over the chain of a: linear.
function linear(a, b) {
  const bases = new Map();
  for (let x = a; x; x = x.parent) { if (bases.has(x.base)) throw new Error("two nodes of one chain share a base"); bases.set(x.base, x); }
  for (let y = b; y; y = y.parent) { const x = bases.get(y.base); if (x !== undefined && x !== y) return true; }
  return false;
}
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let checked = 0, separated = 0;
for (let round = 0; round < 300; round++) {
  // The walk of the validator: enterDisjunction = child, enterAlternative(i > 0) = sibling, leaveDisjunction = parent.
  let cur = new BranchID(null, null); const all = [cur]; let depth = 0;
  for (let step = 0; step < 40; step++) {
    const r = rnd();
    if (r < 0.4 && depth < 7) { cur = cur.child(); depth++; }
    else if (r < 0.7 && depth > 0) { cur = cur.sibling(); }
    else if (depth > 0) { cur = cur.parent; depth--; }
    all.push(cur);
  }
  for (const a of all) for (const b of all) {
    const want = a.separatedFrom(b);
    if (iterative(a, b) !== want || linear(a, b) !== want) throw new Error("differs");
    checked++; if (want) separated++;
  }
}
console.log({ checked, separated });
