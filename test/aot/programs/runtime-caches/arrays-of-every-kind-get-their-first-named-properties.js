// An array gets named properties from code that knows nothing about it: empty literals, literals with elements, arrays that push has grown, copies, arrays of integers, of doubles, of objects and with holes,
// of every length up to beyond what a stub copies. Elements, length, names and their order are what plain Bun has, also after more pushes, and while many such arrays are alive and die.
function name(array, first, second) { array.pos = first; array.end = second; array.hasTrailingComma = false; array.transformFlags = 0; return array; }
function nameMore(array, value) { array.fifth = value; array.sixth = value + 1; return array; }
function nameOnce(array, value) { array.only = value; return array; }
const makers = [
  length => { const a = []; for (let i = 0; i < length; i++) a.push(i); return a; },
  length => { const a = []; for (let i = 0; i < length; i++) a.push(i + 0.5); return a; },
  length => { const a = []; for (let i = 0; i < length; i++) a.push({ at: i }); return a; },
  length => { const a = []; for (let i = 0; i < length; i++) a.push(i % 3 ? "s" + i : i); return a; },
  length => new Array(length),
  length => new Array(length).fill(7),
  length => Array.from({ length }, (_, i) => i * 2),
  length => makers[2](length + 2).slice(1, length + 1),
  length => [1, 2, 3, 4, 5, 6, 7, 8].slice(0, length & 7),
  length => (length & 1 ? [1.5, 2.5] : [{ at: 0 }, "x", 3]),
  length => { const a = [1, 2, 3]; a.length = length % 5; return a; },
  length => { const a = []; a[length] = "last"; return a; },
];
function describe(a) {
  let text = a.length + ":";
  for (let i = 0; i < a.length; i++) text += i in a ? (typeof a[i] === "object" ? "{" + a[i].at + "}" : a[i]) + "," : "-,";
  return text + " " + Object.keys(a).filter(key => !/^\d+$/.test(key)).map(key => key + "=" + a[key]).join();
}
const lines = [];
const kept = [];
for (let length = 0; length < 72; length += length < 12 ? 1 : 7) {
  for (let maker = 0; maker < makers.length; maker++) {
    const a = name(makers[maker](length), -1, length);
    const before = describe(a);
    a.push("pushed");
    nameMore(a, maker);
    a.push(length);
    const b = nameOnce(makers[maker](length), maker);
    b.unshift("front");
    lines.push(maker + " " + before + " | " + describe(a) + " | " + describe(b) + " | " + JSON.stringify(a).length + " " + Array.isArray(a));
    kept.push(a, b);
  }
}
console.log(lines.join("\n"));

// Many arrays that live for a while: what the collector sees of them is whole at every moment.
let sum = 0;
const ring = new Array(512).fill(null);
for (let turn = 0; turn < 60000; turn++) {
  const length = turn % 9;
  const a = name(makers[turn % 4](length), turn, { at: turn });
  const old = ring[turn & 511];
  if (old !== null) {
    sum += old.pos + old.end.at + old.length;
    if (old.length && typeof old[old.length - 1] === "object") sum += old[old.length - 1].at;
  }
  ring[turn & 511] = a;
}
console.log(sum, kept.length, kept.reduce((total, a) => total + a.length, 0), describe(kept[kept.length - 2]));
