// Pieces of a text serve as keys: never, once, twice, three times, ten times, by read, by store, by `in`, by hasOwn and by delete. Then each piece is used as the text that it is.
const text = "alpha beta gamma delta epsilon alpha beta gamma delta epsilon zeta-is-longer-than-sixteen-characters é-and-ü 漢字 x 12 007 __proto__ constructor toString";
const table = { alpha: 1, beta: 2, gamma: 3, delta: 4, x: 5, 12: 6, "007": 7, "é-and-ü": 8, 漢字: 9, "zeta-is-longer-than-sixteen-characters": 10 };
function read(object, key) { return object[key]; }
function store(object, key, value) { object[key] = value; }
function asks(object, key) { return key in object; }
function owns(object, key) { return Object.hasOwn(object, key); }
function remove(object, key) { return delete object[key]; }
const ways = [
  (object, key) => read(object, key),
  (object, key) => (store(object, key, (read(object, key) ?? 0) + 1), read(object, key)),
  (object, key) => asks(object, key),
  (object, key) => owns(object, key),
  (object, key) => [remove(object, key), asks(object, key), (store(object, key, 1), read(object, key))].join(),
];
function describe(piece, other) {
  const map = new Map([[piece, 1]]);
  let kind;
  switch (piece) { case "alpha": kind = "a"; break; case "beta": kind = "b"; break; case "漢字": kind = "k"; break; default: kind = "?"; }
  return [
    piece, piece.length, typeof piece, piece === other, piece == other, piece < "c", piece + "!", "<" + piece + ">" + piece, `${piece}`, piece.slice(1), piece.slice(1, 3).slice(1), piece.charAt(0), piece.charCodeAt(1), piece[2], piece.at(-1),
    piece.toUpperCase(), piece.indexOf("a"), piece.includes("et"), piece.startsWith("al"), piece.split("a").join("|"), piece.replace("a", "A"), piece.padEnd(8, "."), piece.repeat(2), piece.trim(), /^[a-z]+$/.test(piece), piece.match(/[aeiou]/g)?.length,
    JSON.stringify(piece), JSON.stringify({ [piece]: piece }), map.get(other), map.has(piece), new Set([piece, other]).size, kind, [...piece].length, Number(piece), parseInt(piece, 10), encodeURIComponent(piece), piece.localeCompare(other), Symbol.for(piece) === Symbol.for(other), Object.keys({ [piece]: 1 })[0] === other, [piece, other].sort().join(), piece.normalize() === other,
  ].join(" ");
}
const lines = [];
for (let way = 0; way < ways.length; way++) {
  for (const visits of [0, 1, 2, 3, 4, 10]) {
    const pieces = text.split(" "), others = text.split(" ");
    const object = { ...table };
    const answers = [];
    for (let visit = 0; visit < visits; visit++) for (const piece of pieces) answers.push(ways[way](object, piece));
    lines.push(way + " " + visits + " " + answers.join(" ") + " " + JSON.stringify(object));
    for (let i = 0; i < pieces.length; i++) lines.push(describe(pieces[i], others[i]));
    // Pieces of pieces, and pieces kept beyond a collection.
    const inner = pieces.map(piece => piece.slice(0, 4));
    for (let visit = 0; visit < visits; visit++) for (const piece of inner) answers.push(read(object, piece));
    if (typeof Bun !== "undefined") Bun.gc(true);
    lines.push(inner.join() + " " + pieces.join() + " " + answers.length);
  }
}
console.log(lines.length, new Set(lines).size);
console.log(lines.join("\n"));
