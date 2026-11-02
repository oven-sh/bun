// Parsed objects that the collector can already reach are read through record types while it marks. The integers and the small
// numbers in them are chosen so that the bytes of an object with a fixed layout, read as the properties of a plain object, are
// pointers to nowhere, and so that the plain object's bytes, read as the references of a fixed layout, are too: a marker that reads
// one of these objects by the wrong layout crashes at once. Everything the objects held is still there afterwards.
// Env: JSC_useConcurrentGC=1
// Env: JSC_collectContinuously=1
type Row = { a: number; b: number; c: number; d: number; tiny: number; flag: boolean; name: string; tags: string[] };
type Wide = { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; name: string; last: string };
type Child = { a: number; b: number; label: string };
type Parent = { a: number; b: number; left: Child; right: Child; title: string };

const integer = 0x1238;
const tiny = new Float64Array(new BigUint64Array([0x123800001238n]).buffer)[0];

function typedRow(): Row {
  return { a: 1, b: 2, c: 3, d: 4, tiny: 0.5, flag: true, name: "typed", tags: ["t"] };
}
function typedWide(): Wide {
  return { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, name: "typed", last: "typed" };
}
function typedParent(): Parent {
  return { a: 1, b: 2, left: { a: 1, b: 2, label: "l" }, right: { a: 1, b: 2, label: "r" }, title: "typed" };
}
function checkRow(row: Row, i: number): number {
  return row.a === integer && row.b === integer && row.c === integer && row.d === integer + i && row.tiny === tiny && row.flag === (i % 2 === 0) && row.name === "name " + i && row.tags.length === 2 && row.tags[1] === "tag " + i ? 1 : 0;
}
function checkFraction(row: Row, i: number): number {
  return row.a === integer + 0.5 && row.b === integer && row.c === integer && row.d === integer + i && row.tiny === tiny && row.name === "name " + i && row.tags[1] === "tag " + i ? 1 : 0;
}
function checkWide(wide: Wide, i: number): number {
  return wide.a === integer && wide.b === integer && wide.c === integer && wide.d === integer && wide.e === integer && wide.f === integer && wide.g === integer && wide.h === integer + i && wide.name === "name " + i && wide.last === "last " + i ? 1 : 0;
}
function checkParent(parent: Parent, i: number): number {
  return parent.a === integer && parent.b === integer + i && parent.left.a === integer && parent.left.b === integer && parent.left.label === "left " + i && parent.right.a === integer && parent.right.b === integer && parent.right.label === "right " + i && parent.title === "title " + i ? 1 : 0;
}

const kinds = 5;
function parse(i: number): any {
  const n = String(integer);
  switch (i % kinds) {
    case 0:
      return JSON.parse(`{"a":${n},"b":${n},"c":${n},"d":${integer + i},"tiny":${tiny},"flag":${i % 2 === 0},"name":"name ${i}","tags":["x","tag ${i}"]}`);
    case 1:
      return JSON.parse(`{"a":${n},"b":${n},"c":${n},"d":${integer + i},"tiny":${tiny},"flag":${i % 2 === 0},"name":"name ${i}","tags":["x","tag ${i}"],"more":"more ${i}"}`);
    case 2:
      return JSON.parse(`{"a":${n}.5,"b":${n},"c":${n},"d":${integer + i},"tiny":${tiny},"flag":true,"name":"name ${i}","tags":["x","tag ${i}"]}`);
    case 3:
      return JSON.parse(`{"a":${n},"b":${n},"c":${n},"d":${n},"e":${n},"f":${n},"g":${n},"h":${integer + i},"name":"name ${i}","last":"last ${i}"}`);
    default:
      return JSON.parse(`{"a":${n},"b":${integer + i},"left":{"a":${n},"b":${n},"label":"left ${i}"},"right":{"a":${n},"b":${n},"label":"right ${i}"},"title":"title ${i}"}`);
  }
}
function check(made: any, i: number): number {
  switch (i % kinds) {
    case 0:
      return checkRow(made, i);
    case 1:
      return checkRow(made, i) && made.more === "more " + i ? 1 : 0;
    case 2:
      return checkFraction(made, i);
    case 3:
      return checkWide(made, i);
    default:
      return checkParent(made, i);
  }
}
const keys = ["a,b,c,d,tiny,flag,name,tags", "a,b,c,d,tiny,flag,name,tags,more", "a,b,c,d,tiny,flag,name,tags", "a,b,c,d,e,f,g,h,name,last", "a,b,left,right,title"];

const live: any[] = [];
for (let i = 0; i < 60000; i++) live.push({ i, text: "live " + i, next: i ? live[i - 1] : null });

const size = 4096;
const total = 300000;
const waiting: any[] = new Array(size).fill(null);
const converted: any[] = new Array(size).fill(null);
let good = checkRow({ ...typedRow(), a: integer, b: integer, c: integer, d: integer, tiny, name: "name 0", tags: ["x", "tag 0"] }, 0) + typedWide().a + typedParent().a;
for (let i = 0; i < total + 2 * size; i++) {
  const slot = i % size;
  const old = converted[slot];
  if (old !== null) {
    good += check(old, i - 2 * size);
    if (Object.keys(old).join() !== keys[(i - 2 * size) % kinds]) good = -1000000000;
  }
  const next = waiting[slot];
  converted[slot] = next;
  if (next !== null) good += check(next, i - size);
  waiting[slot] = i < total ? parse(i) : null;
}
console.log(good, live.length);
