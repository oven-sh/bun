interface Row {
  id: number;
  name?: string;
  flag?: boolean;
  [key: string]: unknown;
}

const collect = () => Bun.gc(true);
const prototypes = Array.from({ length: 9 }, (_, n) => ({
  base: n,
  who() {
    return "p" + n;
  },
}));

function makeRow(n: number): Row {
  const row: Row = { id: n };
  if (n % 3 === 0) row.name = "n" + n;
  if (n % 4 === 1) row.flag = n % 8 === 1;
  return row;
}

function widen(row: Row, n: number): Row {
  for (let k = 0; k < n % 6; k++) row["extra" + ((n * 7 + k) % 40)] = k + n;
  return row;
}

function reorder(row: Row, n: number): Row {
  if (n % 5 === 0) {
    delete row.name;
    row.late = n;
    row.name = "again" + n;
  }
  if (n % 7 === 0) {
    const id = row.id;
    delete (row as { id?: number }).id;
    row.id = id;
  }
  return row;
}

function describe(row: Row): string {
  const proto = Object.getPrototypeOf(row) as { base?: number; who?: () => string } | null;
  return JSON.stringify(row) + " " + Object.keys(row).join() + " " + (proto?.who ? proto.who.call(row) + proto.base : proto === null ? "null" : "plain");
}

let sum = 0;
const kept: Row[] = [];
for (let round = 0; round < 8; round++) {
  const all: Row[] = [];
  for (let n = 0; n < 900; n++) {
    const row = reorder(widen(makeRow(n), n + round), n);
    if (n % 6 === 2) Object.setPrototypeOf(row, prototypes[(n + round) % prototypes.length]);
    if (n % 97 === 5) Object.setPrototypeOf(row, null);
    if (n % 41 === 3) Object.freeze(row);
    all.push(row);
  }
  for (const row of all) {
    for (const key of Object.keys(row)) {
      const value = row[key];
      sum = (sum + (typeof value === "number" ? value : key.length)) | 0;
    }
  }
  for (let n = round; n < all.length; n += 131) kept.push(all[n]);
  if (round % 2) collect();
}
console.log(sum, kept.length);
for (let n = 0; n < kept.length; n += 5) console.log(n, describe(kept[n]));

// Every variant dies, and the same ones are made again.
kept.length = 0;
collect();
for (let turn = 0; turn < 3; turn++) {
  const made: string[] = [];
  for (let n = 0; n < 60; n++) {
    const row = reorder(widen(makeRow(n), n), n);
    if (n % 2) Object.setPrototypeOf(row, prototypes[n % prototypes.length]);
    if (n % 20 === 7) made.push(describe(row));
  }
  collect();
  console.log(turn, made.join(" | "));
}

// An object below a prototype that takes a place in another object's chain later.
const parent: Row = { id: 1, shared: "from the parent" };
const child = Object.setPrototypeOf({ id: 2 } as Row, parent) as Row;
console.log(child.shared, "shared" in child, Object.keys(child).join());
collect();
parent.shared = "changed";
parent.more = 3;
console.log(child.shared, child.more, JSON.stringify(child), JSON.stringify(parent));
collect();
delete parent.shared;
console.log(child.shared, Object.keys(parent).join(), Object.getPrototypeOf(child) === parent);

// The same changes to objects of classes.
class Node2 {
  value: number;
  [key: string]: unknown;
  constructor(value: number) {
    this.value = value;
  }
  twice() {
    return this.value * 2;
  }
}
class Leaf extends Node2 {
  kind = "leaf";
}
const nodes: Node2[] = [];
for (let n = 0; n < 300; n++) {
  const node = n % 3 ? new Node2(n) : new Leaf(n);
  if (n % 2) node["k" + (n % 23)] = n;
  if (n % 10 === 4) Object.setPrototypeOf(node, prototypes[n % prototypes.length]);
  if (n % 60 === 31) collect();
  nodes.push(node);
}
let total = 0;
for (const node of nodes) total += typeof node.twice === "function" ? node.twice() : Object.keys(node).length;
console.log(total, Object.keys(nodes[33]).join(), Object.keys(nodes[34]).join(), nodes[36] instanceof Leaf, nodes[34] instanceof Node2);
