// A key of more than 2,048 characters that is still in pieces: joined of a list, added to a few times or many times, cut out of a longer text.
// It is compared with the names of the object where its pieces lie. Each way in which that could show: the same text, a text of the same length that differs
// in its first, its last or a middle character, narrow and wide pieces on either side, several names of one length, names found above the object.
const narrow = [];
for (let i = 0; i < 40; i++) narrow.push(("piece " + i + " ").repeat(12));
const wide = narrow.map((piece, i) => (i === 17 ? piece.slice(0, -1) + "€" : piece));

function nameOf(host, list, more) {
  let name = host;
  name += ":";
  name += list.join(",");
  for (const part of more) {
    name += ":";
    if (part !== undefined) name += part;
  }
  return name;
}
function addedToOften(text, times) {
  for (let i = 0; i < times; i++) text += i % 10;
  return text;
}
const makers = {
  fewPieces: () => nameOf("host", narrow, [1, undefined, "two", true, undefined]),
  otherFirst: () => nameOf("hosu", narrow, [1, undefined, "two", true, undefined]),
  otherLast: () => nameOf("host", narrow, [1, undefined, "two", true, undefined]).slice(0, -1) + ";",
  otherMiddle: () => nameOf("host", narrow.map((piece, i) => (i === 20 ? piece.slice(0, -2) + "! " : piece)), [1, undefined, "two", true, undefined]),
  widePiece: () => nameOf("host", wide, [1, undefined, "two", true, undefined]),
  wideEnd: () => nameOf("host", narrow, [1, undefined, "two", true, undefined]).slice(0, -1) + "€",
  cutOut: () => ("<<" + nameOf("host", narrow, [1, undefined, "two", true, undefined]) + ">>").slice(2, -2),
  manyPieces: () => addedToOften(nameOf("host", narrow, []), 900),
  manyPiecesOtherEnd: () => addedToOften(nameOf("host", narrow, []), 899) + "x",
  template: () => `${"host"}:${narrow.join(",")}:${1}::${"two"}:${true}:`,
};
class Holder {
  constructor() {
    this.own = 1;
  }
}
const holders = {
  literal: () => ({}),
  withoutPrototype: () => Object.create(null),
  instance: () => new Holder(),
  list: () => [],
  below: () => Object.create({}),
};
const lines = [];
for (const [kind, makeHolder] of Object.entries(holders)) {
  const holder = makeHolder();
  const stores = kind === "below" ? Object.getPrototypeOf(holder) : holder;
  let number = 0;
  for (const [stored, makeStored] of Object.entries(makers)) {
    const found = [];
    for (const [asked, makeAsked] of Object.entries(makers)) {
      const key = makeAsked();
      const answers = [holder[key], key in holder, Object.prototype.hasOwnProperty.call(holder, key), holder[key]];
      if (answers[0] !== undefined || answers[1] || answers[2]) found.push(asked + "=" + answers.join("/"));
    }
    lines.push(kind + " before " + stored + ": " + found.join(" "));
    stores[makeStored()] = ++number;
    stores[makeStored()] += 100;
  }
  lines.push(kind + " has " + Object.keys(stores).length + " of " + Object.keys(stores).map(key => key.length).join());
  for (const makeKey of Object.values(makers)) delete stores[makeKey()];
  lines.push(kind + " keeps " + Object.keys(stores).join());
}
console.log(lines.join("\n"));
