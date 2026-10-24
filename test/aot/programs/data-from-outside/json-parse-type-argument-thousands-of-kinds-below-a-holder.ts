// A holder with undeclared keys of its own holds up to 66,000 items that each have an undeclared key of their own name: more kinds of object than the parser and the writer remember, met while the holder is being parsed and written.
interface Item { id: number }
interface Holder { first: number; items: Item[]; last: string }
let serial = 0;
const host: any = globalThis;
const which = (host.arguments ?? [])[0] ?? "orders";
for (const count of [10, 255, 256, 257, 4095, 4096, 4097, 16383, 16384, 16385, 20000, 33000]) {
  const items: string[] = [];
  for (let at = 0; at < count; at++) {
    const unique = ++serial;
    items.push(which === "orders" ? (at % 2 ? '{"k' + unique + '":1,"id":' + at + "}" : '{"id":' + at + ',"k' + unique + '":1,"m":2}') : '{"id":' + at + ',"aa' + (unique % 97) + '":1,"aa' + (unique % 89) + 'x":2,"aa' + unique + '":3}');
  }
  const text = '{"a":"before","first":1,"b":[1,2],"items":[' + items.join(",") + '],"c":"behind","last":"l","d":{"e":null},"f":"' + "x".repeat(40) + '"}';
  const written = JSON.stringify(host.JSON.parse(text));
  for (let round = 0; round < 3; round++) console.log(count + " kinds more (" + serial + " in all), round " + round + ": " + (JSON.stringify(JSON.parse<Holder>(text)) === written ? "same" : "DIFFERENT"));
}
