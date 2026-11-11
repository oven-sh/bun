// Under: --aot-testing=CheckProofsAtRunTime: each text is written once more by the general way and held against it
// The rows of a list whose fields hold any value are written without asking how each field is held. One list for each value and each place, for a row that is left to another way ends the short one for its list. Each list is written twice, for the first writing makes a joined text flat.
const box = JSON.parse("[1]");
const keep = value => {
  box[0] = value;
  return box[0];
};
const row = (id, title, price, left) => ({ id, title, price, left });
const titles = ["first", "second", "third", "fourth", "fifth"];

function show(text) {
  if (text.length <= 400) {
    console.log(text);
    return;
  }
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  console.log(text.length, sum, text.slice(0, 80), text.slice(-80));
}

function write(value) {
  for (let turn = 0; turn < 2; turn++) {
    try {
      show(JSON.stringify(value));
    } catch (error) {
      console.log(error.name, error.message);
    }
  }
}

const values = [
  0, 7, 10, 42, 99, 100, 999, 1000, 9999, 10000, 12345678, 99999999, 100000000, 2147483647, -1, -99, -10000, -2147483648,
  -0, 0.5, -0.5, 99.5, 9999.5, 1.5e-7, 123456789.125, 2147483648, -2147483649, 4294967296, 9007199254740993, 1e21, 1e300, 5e-324,
  keep(1.5) * 2, keep(0.5) - 0.5, NaN, Infinity, -Infinity,
  true, false, null, undefined,
  "", "a", 'ab"c', "back\\slash", "line\nbreak", "\u001f", "\u007f", "x".repeat(7), "x".repeat(8), "y".repeat(15), "y".repeat(16), "z".repeat(63), "z".repeat(64),
  "w".repeat(9000), "é", "Ж", "t" + keep("u"), keep("long ").repeat(3) + keep("joined"),
  [1], [], { k: 1 }, {}, () => 1, Symbol("s"), 10n, new Date(0), { toJSON() { return "told"; } }, new String("boxed"), new Number(5.5), new Boolean(false),
];

for (const value of values) {
  for (let place = 0; place < 4; place++) {
    const list = [];
    for (let i = 0; i < 5; i++) {
      const here = i === 2 || i === 3 ? place : -1;
      list.push(keep(row(here === 0 ? value : i, here === 1 ? value : titles[i], here === 2 ? value : i * 250, here === 3 ? value : i > 1)));
    }
    write(list);
  }
}

write([keep(row(1, "a", 2, true)), keep(row()), keep(row(undefined, undefined, undefined, 3)), keep(row(4)), keep(row())]);

const makers = [
  i => ({ twelveLetter: i, b: titles[i] }),
  i => ({ thirteenChars: i, b: titles[i] }),
  i => ({ twelveLetter: i, b: titles[i], thirteenChars: i / 2 }),
  i => ({ twelveLetter: i / 2, b: titles[i], alsoTwelveOf: i > 1 }),
  i => ({ aKeyThatIsLongerThanSixteen: i, b: titles[i], aKeyThatTakesMoreThanTwoBlocksOfSixteenBytes: null }),
  i => ({ 'quo"te': i / 2, b: titles[i] }),
  i => ({ "\u0416\u0443\u043a": i / 2, b: titles[i] }),
  i => ({ "": i / 2, 12: titles[i] }),
  () => ({}),
];
for (const make of makers) {
  const list = [];
  for (let i = 0; i < 4; i++) list.push(keep(make(i)));
  write(list);
}

const closed = [];
for (let i = 0; i < 8; i++) {
  const one = keep(row(i, titles[i % 5], i * 3, i > 4));
  closed.push(i % 4 === 1 ? Object.freeze(one) : i % 4 === 2 ? Object.seal(one) : i % 4 === 3 ? Object.preventExtensions(one) : one);
}
write(closed);
write([...closed].reverse());

const many = [];
for (let i = 0; i < 400; i++) many.push(keep(row(i, "title " + i, i * 37, i % 2 === 0)));
write(many);
write(keep({ owner: { id: 42, name: "Someone", score: 42.5, active: true }, entries: many.slice(0, 50) }));

const changed = [keep(row(1, "a", 2, true)), keep(row(2, "b", 3, false)), keep(row(3, "c", 4, true)), keep(row(4, "d", 5, false))];
delete changed[1].price;
changed[2].extra = 1;
write(changed);
changed[1].price = 9;
write(changed);
write([...changed].reverse());
delete changed[2].extra;
write(changed);

const laid = [keep(row(1, "a", 2, true)), keep(row(2, "b", 3, false)), keep(row(3, "c", 4, true)), keep(row(4, "d", 5, false)), keep(row(5, "e", 6, true))];
Object.defineProperty(laid[1], "price", { get() { return "got"; }, enumerable: true, configurable: true });
Object.defineProperty(laid[2], "title", { value: "hidden", enumerable: false });
laid[3].toJSON = () => "its own";
write(laid);

write([
  keep(row(1, "a", 2, true)), keep(row(2, "b", 3, false)), null, keep(row(3, "c", 4, true)), 5, keep(row(4, "d", 5, false)), "text", keep(row(5, "e", 6, true)), undefined,
  keep(row(6, "f", 7, false)), [keep(row(7, "g", 8, true)), keep(row(8, "h", 9, false))], keep({ other: 1 }), keep(row(9, "i", 10, true)), keep(row(10, "j", 11, false)),
]);
write([keep(row(1, "a", 2, true)), keep(row(2, "b", 3, false)), , keep(row(3, "c", 4, true))]);

class Entry {
  constructor(id, title) {
    this.id = id;
    this.title = title;
  }
}
class Told extends Entry {
  toJSON() {
    return this.title;
  }
}
write([keep(new Entry(1, "a")), keep(new Entry(2, "b")), keep(new Entry(3, 0.25)), keep(new Told(4, "c")), keep(new Entry(5, null))]);

const typed = [];
for (let i = 0; i < 6; i++) typed.push({ id: i, price: i * 3.5, ok: i > 2, name: titles[i % 5] });
write(typed);
