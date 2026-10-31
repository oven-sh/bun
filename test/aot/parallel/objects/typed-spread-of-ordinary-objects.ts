// A spread under a declared type whose source is an ordinary object: repeated copies go by loads and stores, and a value that does not go into its slot as it is takes the long way and arrives all the same.
interface Point { a: number; b: number; c: string; d: number; e: boolean; f: unknown }
interface Labeled extends Point { label: number }
const parse = (text: string): any => JSON.parse(text);
const whole = (source: any): Point => { const point: Point = source; return { ...point }; };
const inFront = (source: any, i: number): Labeled => { const point: Point = source; return { ...point, label: i }; };
const show = (value: any): string =>
  Reflect.ownKeys(value).map(key => String(key) + ":" + (Object.is(value[key], -0) ? "-0" : typeof value[key] === "object" ? JSON.stringify(value[key]) : String(value[key]))).join();
let hash = 0;
const mix = (text: string) => {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
};

const usual = [parse('{"a":1,"b":2,"c":"three","d":4,"e":true,"f":[5]}'), parse('{"a":1.5,"b":-2,"c":"","d":2147483647,"e":false,"f":"six"}')];
for (let i = 0; i < 3000; i++) {
  const copy = whole(usual[i & 1]);
  const labeled = inFront(usual[i & 1], i);
  copy.a += i;
  labeled.c += "!";
  if (i % 500 === 0) mix(show(copy) + ";" + show(labeled) + ";" + show(usual[i & 1]));
}
console.log(hash, show(whole(usual[0])), show(inFront(usual[1], 7)));

// One Structure, values of every kind in every place. Each comes between copies of the usual values.
const odd: unknown[] = [undefined, null, 0, -0, NaN, Infinity, 1e300, 0.5, -2147483648, -2147483647, -2147483644, -2147483643, 2147483648, "text", "", true, false, {}, [1], () => 1, Symbol.for("s"), 10n];
for (const name of ["a", "b", "c", "d", "e", "f"]) {
  let line = name;
  for (const value of odd) {
    for (let i = 0; i < 12; i++) whole(usual[0]);
    const source = parse('{"a":1,"b":2,"c":"three","d":4,"e":true,"f":[5]}');
    source[name] = value;
    line += " " + show(whole(source)).length + "/" + show(inFront(source, 1)).length;
    mix(show(whole(source)) + show(inFront(source, 2)));
  }
  console.log(line);
}
console.log(hash);

// Other Structures: other orders, fewer names, more names, names outside the cell, a getter, a hidden name, a symbol, an index.
const others: any[] = [
  parse('{"f":1,"e":true,"d":2,"c":"c","b":3,"a":4}'),
  parse('{"a":1,"c":"c"}'),
  parse('{}'),
  parse('{"a":1,"b":2,"c":"three","d":4,"e":true,"f":5,"g":6}'),
  parse('{"a":1,"b":2,"c":"three","d":4,"e":true,"f":5,"g":6,"h":7,"i":8}'),
  Object.defineProperty(parse('{"a":1,"b":2}'), "c", { get() { return "got"; }, enumerable: true }),
  Object.defineProperty(parse('{"a":1,"b":2}'), "c", { value: "hidden", enumerable: false }),
  Object.assign(parse('{"a":1,"b":2}'), { [Symbol.for("key")]: 3 }),
  Object.assign(parse('{"a":1,"b":2}'), { 0: "zero" }),
  Object.freeze(parse('{"a":1,"b":2,"c":"frozen"}')),
  Object.create({ a: "inherited" }, { b: { value: 2, enumerable: true } }),
];
for (const other of others) {
  let last = "";
  for (let i = 0; i < 20; i++) last = show(whole(other)) + "|" + show(inFront(other, i));
  console.log(last);
}

// A collection forgets what the copies had learned, and Structures that are gone come again under other names.
for (let round = 0; round < 6; round++) {
  const key = "k" + round;
  const source = parse('{"a":' + round + ',"b":2,"c":"three","d":4,"e":true,"f":5}');
  const stranger = parse('{"' + key + '":1,"a":2,"b":3}');
  for (let i = 0; i < 40; i++) mix(show(whole(source)) + show(whole(stranger)));
  Bun.gc(true);
  mix(show(whole(source)) + show(whole(stranger)));
}
console.log(hash);
