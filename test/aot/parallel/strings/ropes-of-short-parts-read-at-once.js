// Two or three strings are joined and the result is read at once: parts of every length from 0 to 40, Latin-1 and UTF-16, flat strings, slices and ropes.
const lines = [];
const latin1 = "abcdefghijklmnopqrstuvwxyz0123456789\xe9\xff\x80\x00ABCD";
const wide = "Ł中😀" + latin1;
const unitsOf = text => {
  const units = [];
  for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
  return units;
};
const flat = (source, start, length) => String.fromCharCode(...unitsOf(source).slice(start, start + length));
const slice = (source, start, length) => source.slice(start, start + length);
const rope = (source, start, length) => (length < 2 ? flat(source, start, length) : flat(source, start, 1) + flat(source, start + 1, length - 1));

function check(label, makers, sources) {
  let wrong = 0;
  let sum = 0;
  let count = 0;
  for (let a = 0; a <= 40; a += a < 20 ? 1 : 5) {
    for (let b = 0; b <= 40; b += b < 18 ? 1 : 11) {
      for (const c of [-1, 0, 1, 7, 8, 17]) {
        const lengths = c < 0 ? [a, b] : [a, b, c];
        const parts = lengths.map((length, index) => makers[index % makers.length](sources[index % sources.length], index + 1, length));
        const expected = lengths.flatMap((length, index) => unitsOf(sources[index % sources.length]).slice(index + 1, index + 1 + length));
        const text = c < 0 ? parts[0] + parts[1] : parts[0] + parts[1] + parts[2];
        let same = text.length === expected.length;
        for (let i = 0; i < text.length; i++) {
          const unit = text.charCodeAt(i);
          sum = (sum * 31 + unit) | 0;
          same &&= unit === expected[i];
        }
        if (!same || text !== String.fromCharCode(...expected)) wrong++;
        count++;
      }
    }
  }
  lines.push(`${label}: ${count} joined, ${wrong} wrong, ${sum}`);
}
check("flat", [flat], [latin1]);
check("slices", [slice], [latin1]);
check("flat and slices", [flat, slice], [latin1]);
check("ropes", [rope, flat], [latin1]);
check("wide", [flat], [wide]);
check("wide and narrow", [flat, slice], [latin1, wide]);
check("slices of wide", [slice], [wide]);

const kept = [];
for (let i = 0; i < 2000; i++) kept.push(flat(latin1, i % 7, i % 23) + slice(latin1, i % 5, i % 19));
let total = 0;
for (const text of kept) for (let i = 0; i < text.length; i++) total += text.charCodeAt(i);
for (const text of kept) for (let i = 0; i < text.length; i++) total -= text.charCodeAt(i);
lines.push(`kept and read twice: ${kept.length}, ${total}, ${kept[1999]}`);
console.log(lines.join("\n"));
