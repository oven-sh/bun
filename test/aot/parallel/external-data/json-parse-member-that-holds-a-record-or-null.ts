// A member of a record holds another record in one text and null in the next, in every order, alone and in lists, with members beside those of the types:
// each text is parsed into its type, whichever form of the record the parser met first. The log stays empty.
// Flags: --aot-log-type-mismatches
interface Inner {
  a: number;
  b: string;
}
interface Outer {
  id: number;
  inner: Inner | null;
  name: string;
}
interface First {
  id: number;
  inner: Inner | null;
}
interface Listed {
  id: number;
  items: Inner[] | null;
}
interface Chain {
  value: number;
  next: Chain | null;
}
interface Left {
  id: number;
  right: Right | null;
}
interface Right {
  id: number;
  left: Left | null;
}

const inner = (i: number) => `{"a":${i},"b":"x${i & 3}","beside":${i}}`;
const withRecord = (i: number) => `{"id":${i},"inner":${inner(i)},"name":"n","more":true}`;
const withNull = (i: number) => `{"id":${i},"inner":null,"name":"n","more":true}`;

function sumOuter(outer: Outer): number {
  return (
    outer.id +
    (outer.inner === null ? 1 : outer.inner.a + outer.inner.b.length) +
    outer.name.length +
    Object.keys(outer).length
  );
}
const readOuter = (text: string) => JSON.parse(text) as Outer;
const readOuters = (text: string) => JSON.parse(text) as Outer[];

let sum = 0;
for (let i = 0; i < 40; i++) sum += sumOuter(readOuter(withRecord(i)));
for (let i = 0; i < 40; i++) sum += sumOuter(readOuter(i & 1 ? withNull(i) : withRecord(i)));
for (let i = 0; i < 40; i++) sum += sumOuter(readOuter(withNull(i)));
console.log("a record, then in turn, then null", sum);

sum = 0;
for (const every of [1, 2, 3, 10, 100]) {
  const parts: string[] = [];
  for (let i = 0; i < 100; i++) parts.push(i % every === every - 1 ? withNull(i) : withRecord(i));
  for (let round = 0; round < 4; round++) for (const outer of readOuters(`[${parts.join()}]`)) sum += sumOuter(outer);
}
console.log("lists", sum);

// The first text of the type holds null.
const readFirst = (text: string) => JSON.parse(text) as First;
sum = 0;
for (let i = 0; i < 40; i++) {
  const first = readFirst(i < 3 ? `{"more":1,"id":${i},"inner":null}` : `{"more":1,"id":${i},"inner":${inner(i)}}`);
  sum += first.id + (first.inner === null ? 1 : first.inner.a);
}
console.log("null first", sum);

// A list where the form that was met first holds null.
const readListed = (text: string) => JSON.parse(text) as Listed;
sum = 0;
for (let i = 0; i < 40; i++) {
  const listed = readListed(
    i % 5 < 3 ? `{"more":1,"id":${i},"items":null}` : `{"more":1,"id":${i},"items":[${inner(i)},${inner(i + 1)}]}`,
  );
  sum += listed.id;
  if (listed.items !== null) for (const item of listed.items) sum += item.a + item.b.length;
}
console.log("a list or null", sum);

function chain(levels: number, forms: number, end: string): string {
  let text = "null";
  for (let i = 0; i < levels; i++)
    text = `{"more":1,"next":${text},"value":${i},"${forms > 1 && i & 1 ? "p" : "q"}":1${i === 0 ? end : ""}}`;
  return text;
}
function each(levels: number): string {
  let text = "null";
  for (let i = 0; i < levels; i++)
    text = (levels - i) & 1 ? `{"more":1,"id":${i},"right":${text}}` : `{"more":1,"id":${i},"left":${text}}`;
  return text;
}
const readChain = (text: string) => JSON.parse(text) as Chain;
const readLeft = (text: string) => JSON.parse(text) as Left;
sum = 0;
for (const forms of [1, 2]) {
  for (const end of ["", ',"odd":1']) {
    for (const levels of [1, 2, 3, 4, 1, 2, 3, 4, 5, 8, 40, 400, 400]) {
      for (let link: Chain | null = readChain(chain(levels, forms, end)); link !== null; link = link.next)
        sum += link.value + 1;
    }
  }
}
console.log("records that hold their own type", sum);
sum = 0;
for (const levels of [1, 2, 3, 4, 1, 2, 3, 4, 5, 8, 41, 401, 401]) {
  let left: Left | null = readLeft(each(levels));
  while (left !== null) {
    sum += left.id + 1;
    const right: Right | null = left.right;
    if (right === null) break;
    sum += right.id + 1;
    left = right.left;
  }
}
console.log("records that hold each other's type", sum);
