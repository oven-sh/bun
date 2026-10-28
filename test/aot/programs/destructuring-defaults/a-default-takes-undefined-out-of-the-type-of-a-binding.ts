// A binding with a default that is never `undefined` has the type of its property without `undefined`.
let { a, b = 1 }: { a: number; b?: number } = { a: 1 };
const fromLiteral: number = b;
console.log(a, fromLiteral);

async function awaits() {
  let { c = await Promise.resolve(2), d = await Promise.resolve(3).then<number, never>((value: number) => value) }: { c?: number; d?: number } = {};
  const read = () => c;
  const fromAwait: number = c;
  const fromThen: number = d;
  console.log(fromAwait, fromThen, read());
}
await awaits();

let [x = 4, y = "s"]: [number?, string?] = [];
const fromList: number = x;
const text: string = y;
console.log(fromList, text);

let { o: { e = 5 } = {}, l: [f = 6] = [] }: { o?: { e?: number }; l?: [number?] } = {};
const nested: number = e;
const nestedInList: number = f;
console.log(nested, nestedInList);

let { g = 7, h = undefined, i = null }: { g: number | undefined; h?: number; i?: number | null } = { g: undefined };
const declaredUndefined: number = g;
const keepsUndefined: number | undefined = h;
const takesNull: number | null = i;
console.log(declaredUndefined, keepsUndefined, takesNull);

function parameters({ j, k = 8 }: { j: number; k?: number }, [m = 9]: [number?] = []) {
  const fromObject: number = k;
  const fromTuple: number = m;
  return j + fromObject + fromTuple;
}
console.log(parameters({ j: 1 }));

let p: number, q: number;
const optional: { p?: number; q?: number } = {};
({ p = 10, q = 11 } = optional);
console.log(p, q);
[p = 12, q = 13] = [] as number[];
console.log(p, q);

const records: { r?: number }[] = [{}, { r: 15 }];
for (const { r = 14 } of records) {
  const inLoop: number = r;
  console.log(inLoop);
}

let { s = 16 }: { s?: number } = {};
const captured = () => s;
s = 17;
const afterStore: number = captured();
console.log(afterStore);
export {};
