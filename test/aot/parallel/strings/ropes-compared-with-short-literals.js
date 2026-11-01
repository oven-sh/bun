// Ropes of two and three pieces compared with literals of one to eight characters: flat pieces, slices, nested ropes and 16-bit pieces, equal and different at every position.
const tests = [
  s => s === "a",
  s => s === "ab",
  s => s === "abc",
  s => s === "abcd",
  s => s === "abcde",
  s => s === "abcdef",
  s => s === "abcdefg",
  s => s === "abcdefgh",
];
const wide = text => Buffer.from(text, "utf16le").toString("utf16le");
const flat = text => (/[^\u0000-\u00ff]/.test(text) ? wide(text) : Buffer.from(text, "latin1").toString("latin1"));
const sliced = text => flat(`<${text}>`).slice(1, -1);
const nested = text => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + flat(text.slice(1)));
const kinds = { flat, wide, sliced, nested };
function join(pieces) {
  let rope = pieces[0];
  if (pieces.length === 2) rope = pieces[0] + pieces[1];
  if (pieces.length === 3) rope = pieces[0] + pieces[1] + pieces[2];
  return rope;
}
function cuts(text) {
  const found = [];
  for (let i = 1; i < text.length; i++) {
    found.push([text.slice(0, i), text.slice(i)]);
    for (let k = i + 1; k < text.length; k++) found.push([text.slice(0, i), text.slice(i, k), text.slice(k)]);
  }
  return found;
}
for (const [name, make] of Object.entries(kinds)) {
  const row = [];
  for (let length = 1; length <= 8; length++) {
    const text = "abcdefgh".slice(0, length);
    const others = [text];
    for (let at = 0; at < length; at++) {
      others.push(text.slice(0, at) + "z" + text.slice(at + 1));
      others.push(text.slice(0, at) + "é" + text.slice(at + 1));
      others.push(text.slice(0, at) + "š" + text.slice(at + 1));
    }
    let equal = 0;
    let asked = 0;
    for (const other of others) {
      for (const cut of cuts(other)) {
        for (let odd = 0; odd <= cut.length; odd++) {
          const rope = join(cut.map((piece, index) => (index === odd ? make(piece) : flat(piece))));
          for (let round = 0; round < 2; round++) {
            asked++;
            for (let test = 0; test < tests.length; test++) {
              const said = tests[test](rope);
              if (said !== (test + 1 === length && other === text)) console.log("wrong", name, JSON.stringify(cut), test, round);
              if (said) equal++;
            }
          }
        }
      }
    }
    row.push(`${length}:${equal}/${asked}`);
  }
  console.log(name, row.join(" "));
}
