// Impostors narrowing and accessors: wg probes shrink  literal target. It prints what plain Bun prints.
type Cell = { leaf: { weight: number } | null };

function make(): Cell {
  return { leaf: { weight: 7 } };
}

function weigh(c: Cell): number {
  return c.leaf === null ? -1 : c.leaf.weight;
}

const cell = make();
Object.assign(cell, { leaf: null });
console.log(weigh(cell));
