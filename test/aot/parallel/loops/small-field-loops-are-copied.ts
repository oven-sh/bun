// Small methods with one loop over a list in a field, called twice an iteration: typed lists, lists of either kind, replaced and missing lists, bounds that are left, keys of other kinds, heirs that override, throws within the loop.
const show = (v: any) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v));
class Sets {
  parent: any;
  steps = 0;
  constructor(list: any) {
    this.parent = list;
    for (let i = 0; i < list.length; i++) this.parent[i] = i;
  }
  find(x: any): any {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  join(a: any, b: any): any {
    a = this.find(a);
    b = this.find(b);
    if (a !== b) this.parent[a] = b;
    return a !== b;
  }
}
class Counted extends Sets {
  find(x: any): any {
    this.steps++;
    return super.find(x);
  }
}
class Row {
  cells: any;
  constructor(cells: any) {
    this.cells = cells;
  }
  indexOf(x: any): any {
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === x) return i;
    return -1;
  }
  sumTo(n: any): any {
    let s = 0;
    for (let i = 0; i < n; i++) s += this.cells[i];
    return s;
  }
  both(x: any, n: any): any {
    return this.indexOf(x) + this.sumTo(n);
  }
}
function attempt(name: string, f: () => any): void {
  try {
    console.log(name, show(f()));
  } catch (error: any) {
    console.log(name, error.name);
  }
}
function run(sets: any, k: number, mask: number): any {
  let s = 0;
  for (let i = 0; i < k; i++) if (sets.join(i & mask, (i * 7) & mask)) s++;
  return s;
}
function rows(row: any, k: number, x: any): any {
  let s = 0;
  for (let i = 0; i < k; i++) s += row.both(i & 3, i & 1) + row.indexOf(x);
  return s;
}
const typed = new Sets(new Int32Array(64)), plain = new Sets(new Array(16).fill(0)), small = new Sets(new Uint8Array(8)), counted = new Counted(new Int32Array(32));
for (const k of [0, 1, 40, 1000]) {
  attempt("typed", () => run(typed, k, 63));
  attempt("plain", () => run(plain, k, 15));
  attempt("small", () => run(small, k, 7));
  attempt("counted", () => run(counted, k, 31) + "/" + counted.steps);
}
console.log(show(Array.from(typed.parent)), show(plain.parent), show(Array.from(small.parent)));
const row = new Row([3, 1, 2, 0]), floats = new Row(new Float64Array([0.5, 1, 2, 3])), texts = new Row(["a", "b", 2, 3]);
for (const k of [0, 5, 100]) {
  attempt("row", () => rows(row, k, 2));
  attempt("floats", () => rows(floats, k, 0.5));
  attempt("texts", () => rows(texts, k, "b"));
  attempt("bound", () => row.sumTo(k));
}
row.cells = [1.5, 2];
attempt("replaced", () => rows(row, 9, 2));
row.cells = undefined;
attempt("missing", () => rows(row, 9, 2));
plain.parent = new Int32Array(16);
attempt("zeros", () => run(plain, 3, 15));
attempt("key", () => typed.find("3" as any));
console.log(show(Array.from(counted.parent)));
