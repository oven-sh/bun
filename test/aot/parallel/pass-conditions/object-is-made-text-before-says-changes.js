// `${it}` asks the object at once. What the object would say changes before the text becomes part of a key.
let n = 0;
const speakers = [
  {
    toString() {
      return "k" + n;
    },
  },
  {
    toString() {
      n += 10;
      return "j" + n;
    },
  },
  "plain",
  7,
];
const table = { k0x: "first", k1x: "second", j10x: "third", j21x: "fourth", plainx: "fifth", "7x": "sixth" };
function look(it) {
  const text = `${it}`;
  n++;
  return table[text + "x"];
}
const said = [];
for (let at = 0; at < 8; at++) {
  n = at % 2;
  said.push(look(speakers[at % 4]));
}
console.log(said.join());
