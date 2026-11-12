class Ring {
  length = 0;
  add(value: unknown) {
    (this as any)[this.length & 7] = value;
    this.length++;
  }
}
function make(n: number): any {
  return { n };
}
function store(object: any, key: any, value: unknown) {
  object[key] = value;
}
function define(key: any, value: unknown): any {
  return { n: value, [key]: value };
}
function quietly(work: () => void) {
  try {
    work();
  } catch {}
}
function show(what: string, object: any) {
  console.log(what, JSON.stringify(object), Object.keys(object).join());
}
for (let i = 0; i < 4; i++) store(make(i), 0, i);
const first = make(0);
store(first, 2, "c");
store(first, 0, "a");
show("order", first);
store(first, 1, 1.5);
store(first, -1, "m");
show("a hole and a name", first);
const kinds = make(1);
store(kinds, 0, 1);
store(kinds, 1, 2);
store(kinds, 0, 0.5);
delete kinds[1];
store(kinds, 1, null);
show("other kinds", kinds);
for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) {
  const closed = make(2);
  store(closed, 0, 1);
  close(closed);
  quietly(() => store(closed, 0, 9));
  quietly(() => store(closed, 1, 9));
  const bare = make(3);
  close(bare);
  quietly(() => store(bare, 0, 9));
  console.log(close.name, closed[0], closed[1], bare[0]);
}
let seen: unknown[] = [];
const watched = make(3);
Object.defineProperty(watched, 0, {
  get() {
    return "got";
  },
  set(value) {
    seen.push(value);
  },
  configurable: true,
});
store(watched, 0, 5);
console.log(seen.join(), watched[0]);
seen = [];
const below = make(4);
store(below, 5, 1);
Object.setPrototypeOf(below, {
  set 0(value: unknown) {
    seen.push(value);
  },
});
store(below, 0, "x");
store(below, 5, 2);
console.log(seen.join(), Object.keys(below).join(), below[5]);
const above = make(6);
const heir = Object.create(above);
store(above, 0, "d0");
store(above, 0, "d1");
store(above, 1, "new");
console.log(heir[0], heir[1]);
show("defined", define(3, "v"));
show("defined under a text", define("p", "v"));
show("defined under a negative", define(-2, "v"));
const ring = new Ring();
for (let i = 0; i < 100; i++) ring.add(i);
show("a ring", ring);
const grown = make(7);
for (let i = 0; i < 200; i++) store(grown, i, i * 2);
let sum = 0;
for (let i = 0; i < 200; i++) sum += grown[i];
console.log(sum, Object.keys(grown).length, grown.n);
const kept: any[] = [];
for (let i = 0; i < 2000; i++) {
  const record = make(i);
  store(record, i & 7, { i });
  store(record, 8 + (i & 31), { i });
  kept.push(record);
}
let holds = true;
for (let i = 0; i < kept.length; i++)
  holds &&= kept[i][i & 7].i === i && kept[i][8 + (i & 31)].i === i && kept[i].n === i;
console.log(holds);
store(grown, 4294967294, "last index");
store(grown, 4294967295, "no index");
store(grown, 1.5, "no integer");
console.log(grown[4294967294], grown[4294967295], grown[1.5], Object.keys(grown).length);
