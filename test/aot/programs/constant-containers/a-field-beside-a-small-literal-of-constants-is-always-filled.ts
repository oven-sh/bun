// `n: number;` is defined as undefined and the constructor stores a number before anybody can look. A field beside it that begins as `[]`, `[1, 2]`, `{}` or `{ deep: true }` runs no code and
// cannot fail, so the field is always filled with a number.
// IR-UNTIL ApplyFlowResults
// IR+ ^layout .*name="BesideEmptyList" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
// IR+ ^layout .*name="BesideList" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
// IR+ ^layout .*name="BesideEmptyRecord" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
// IR+ ^layout .*name="BesideRecord" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
// IR+ ^layout .*name="BesideRows" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
class Base {
  id: number = 1;
}
class BesideEmptyList extends Base {
  list: number[] = [];
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
}
class BesideList extends Base {
  list: number[] = [1, 2];
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
}
class BesideEmptyRecord extends Base {
  record: object = {};
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
}
class BesideRecord extends Base {
  options = { deep: true, limit: 4 };
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
}
class BesideRows extends Base {
  rows = [
    { id: 1, tag: "a" },
    { id: 2, tag: "b" },
  ];
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
}
class BesideVariablePart extends Base {
  list: number[] = [this.id];
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
}

const turns = 40;
let total = 0;
for (let i = 0; i < turns; i++) {
  const a = new BesideEmptyList(i);
  const b = new BesideList(i);
  const c = new BesideEmptyRecord(i);
  const d = new BesideRecord(i);
  const e = new BesideRows(i);
  const f = new BesideVariablePart(i);
  a.list.push(a.n);
  b.list.push(b.n);
  d.options.limit += d.n;
  e.rows[1].id += e.n;
  total += a.list.length + a.list[0] + b.list[2] + Object.keys(c.record).length + c.n + d.options.limit + e.rows[1].id + e.rows[0].tag.length + f.list[0] + f.n;
}
console.log(total);

// Each evaluation makes new objects.
const first = new BesideRows(1);
const second = new BesideRows(2);
first.rows[0].tag = "changed";
first.rows.push({ id: 3, tag: "c" });
console.log(first.rows.length, second.rows.length, first.rows[0].tag, second.rows[0].tag, first.rows !== second.rows, first.rows[1] !== second.rows[1]);
console.log(JSON.stringify(new BesideRecord(7)), JSON.stringify(new BesideEmptyList(8)), JSON.stringify(new BesideEmptyRecord(9)));
