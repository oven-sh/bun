// Bun.YAML.parse keeps what an alias names shared, and validate<T> copies a value as a tree, so N nested aliases cost 2^N copies. The YAML parser refuses more than twenty such levels: that bound is what keeps a small text from costing more than a second or two here.
import { validate } from "bun:bundle";
type Forked = { left: Forked | null; right: Forked | null };

function nested(levels: number): string {
  const lines = ["a0: &a0 { left: null, right: null }"];
  for (let level = 1; level <= levels; level++) lines.push("a" + level + ": &a" + level + " { left: *a" + (level - 1) + ", right: *a" + (level - 1) + " }");
  return lines.join("\n") + "\n";
}

for (const levels of [1, 2, 10, 16, 20, 21, 30, 1000]) {
  try {
    const top = (Bun.YAML.parse(nested(levels)) as any)["a" + levels];
    const copy = validate<Forked>(top);
    let depth = 0;
    for (let at: Forked | null = copy; at; at = depth % 2 ? at.left : at.right) depth++;
    console.log(levels + " levels: shared as parsed: " + (top.left === top.right) + ", shared in the copy: " + (copy.left === copy.right) + ", depth " + depth);
  } catch (error: any) {
    console.log(levels + " levels: " + error.name + ": " + error.message);
  }
}
