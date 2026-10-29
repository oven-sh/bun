// Typed objects with undeclared keys of thousands of kinds are cloned, spread, assigned, frozen, listed and compared: every road that copies or lists a typed object, past the caps of what those roads remember.
interface Item { id: number }
interface Holder { first: number; items: Item[]; last: string }
let serial = 0;
function holderText(count: number): string {
  const items: string[] = [];
  for (let at = 0; at < count; at++) items.push(at % 2 ? '{"id":' + at + ',"k' + ++serial + '":' + at + "}" : '{"p' + ++serial + '":[' + at + '],"id":' + at + ',"q":"s"}');
  return '{"a":"before","first":1,"items":[' + items.join(",") + '],"c":"behind","last":"l","d":{"e":null}}';
}
const roads: [string, (holder: Holder) => unknown][] = [
  ["structuredClone", holder => structuredClone(holder)],
  ["structuredClone of each item", holder => ({ ...holder, items: holder.items.map(item => structuredClone(item)) })],
  ["spread", holder => ({ ...holder, items: holder.items.map(item => ({ ...item })) })],
  ["Object.assign", holder => Object.assign({}, holder, { items: holder.items.map(item => Object.assign({}, item)) })],
  ["Object.entries", holder => Object.fromEntries(Object.entries(holder).map(([key, value]) => [key, key === "items" ? (value as Item[]).map(item => Object.fromEntries(Object.entries(item))) : value]))],
  ["for in", holder => {
    const copy: any = {};
    for (const key in holder) copy[key] = (holder as any)[key];
    copy.items = holder.items.map(item => {
      const made: any = {};
      for (const key in item) made[key] = (item as any)[key];
      return made;
    });
    return copy;
  }],
  ["own property descriptors", holder => Object.defineProperties({}, Object.getOwnPropertyDescriptors({ ...holder, items: holder.items.map(item => Object.defineProperties({}, Object.getOwnPropertyDescriptors(item))) }))],
  ["frozen, then spread", holder => ({ ...Object.freeze(holder), items: holder.items.map(item => ({ ...Object.freeze(item) })) })],
  ["rest", holder => {
    const { first, ...rest } = holder;
    return { a: (rest as any).a, first, items: holder.items.map(({ ...all }) => all), c: (rest as any).c, last: rest.last, d: (rest as any).d };
  }],
];
for (const [label, copy] of roads) {
  const wrong: number[] = [];
  for (const count of [10, 4095, 4096, 4097, 8200, 16385, 20000]) {
    const text = holderText(count);
    const holder = JSON.parse(text) as Holder;
    if (JSON.stringify(copy(holder)) !== text || JSON.stringify(copy(holder)) !== text || JSON.stringify(holder) !== text) wrong.push(count);
  }
  console.log(label + ": " + wrong.length + " differ" + (wrong.length ? " (" + wrong.join() + ")" : ""));
}
