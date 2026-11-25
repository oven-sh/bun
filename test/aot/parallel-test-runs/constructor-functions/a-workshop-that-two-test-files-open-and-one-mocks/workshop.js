export function workshop(label) {
  function Leaf(kind, pos, end) { this.kind = kind; this.pos = pos; this.end = end; this.id = 0; this.parent = null; }
  function make(kind, pos, end) { return new Leaf(kind, pos, end); }
  return { Leaf, make, label };
}
export const show = leaf => Object.keys(leaf).join() + "|" + [leaf.kind, leaf.pos, leaf.end, leaf.id, leaf.parent].join();
