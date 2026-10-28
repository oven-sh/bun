// A type whose fields are all optional takes a map, a list, an error and a function; an index signature takes a bare and a parsed object
interface Options {
  strict?: boolean;
  depth?: number;
}
interface Bag {
  [key: string]: number;
}
function opts(o: Options): string {
  return o.strict + "|" + o.depth + "|" + Object.keys(o).join() + "|" + Array.isArray(o) + "|" + (o instanceof Map);
}
function bag(b: Bag): string {
  return b.a + "|" + Object.keys(b).join() + "|" + (b instanceof Object);
}
const a: Options[] = [
  {},
  { strict: true },
  new Map() as Options,
  [] as Options,
  new Error("x") as Options,
  (() => 1) as Options,
];
const b: Bag[] = [{ a: 1 }, Object.create(null), JSON.parse('{"a":3,"z":4}')];
for (let round = 0; round < 3; round++) {
  for (const v of a) console.log(opts(v));
  for (const v of b) console.log(bag(v));
}
