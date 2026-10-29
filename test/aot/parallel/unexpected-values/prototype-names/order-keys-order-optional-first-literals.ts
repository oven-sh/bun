// Four declared optional fields are stored for the first time outside the constructor, in all 24 orders, around two fields that the constructor stores.
// Object.keys, for-in, JSON.stringify, entries, spread and Reflect.ownKeys must list them in the order of creation, not in the order of declaration or of the slots.
// In this twin the objects are literals typed by an interface: the optional fields are declared, and their slots are empty from birth. Every object may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
interface Row {
  first: number;
  a?: number;
  b?: string;
  c?: { n: number };
  d?: boolean;
  last: number;
}
function makeRow(): Row {
  const made: Row = { first: 1, last: 2 };
  handOver(made);
  return made;
}
function setA(row: Row) {
  row.a = 10;
}
function setB(row: Row) {
  row.b = "bee";
}
function setC(row: Row) {
  row.c = { n: 3 };
}
function setD(row: Row) {
  row.d = false;
}
const setters = [setA, setB, setC, setD];
function forIn(row: Row) {
  const names: string[] = [];
  for (const name in row) names.push(name);
  return names.join("");
}
function listings(row: Row) {
  const short = (names: string[]) => names.map(name => name[0]).join("");
  const all = [
    short(Object.keys(row)),
    short(forIn(row).replace("first", "f").replace("last", "l").split("")),
    short(Object.keys(JSON.parse(JSON.stringify(row)))),
    short(Object.entries(row).map(entry => entry[0])),
    short(Object.keys({ ...row })),
    short(Reflect.ownKeys(row) as string[]),
    short(Object.getOwnPropertyNames(row)),
    short(Object.keys(Object.assign({}, row))),
  ];
  return all.every(text => text === all[0]) ? all[0] : "DISAGREE " + all.join(" ");
}
function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
}

let length = 0;
for (let i = 0; i < 1500; i++) {
  const row = makeRow();
  setters[i & 3](row);
  setters[(i >> 2) & 3](row);
  length += listings(row).length;
}
console.log("warm", length);

const orders = permutations([0, 1, 2, 3]);
console.log("all four:", orders.map(order => { const row = makeRow(); for (const index of order) setters[index](row); return listings(row); }).join(" "));
console.log("the first two of each order:", orders.map(order => { const row = makeRow(); setters[order[0]](row); setters[order[1]](row); return listings(row); }).join(" "));
console.log(
  "a name that is not declared between them:",
  orders.map(order => {
    const row = makeRow();
    setters[order[0]](row);
    (row as any).x = 1;
    setters[order[1]](row);
    (row as any)[7] = 1;
    setters[order[2]](row);
    return listings(row);
  }).join(" "),
);
console.log(
  "stored a second time, which moves nothing:",
  orders.slice(0, 6).map(order => {
    const row = makeRow();
    for (const index of order) setters[index](row);
    for (const index of [0, 1, 2, 3]) setters[index](row);
    row.first = 5;
    return listings(row);
  }).join(" "),
);
console.log("json:", JSON.stringify((() => { const row = makeRow(); setD(row); setB(row); setA(row); return row; })()));
