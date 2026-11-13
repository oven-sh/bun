// Scanners whose loops end at a bound that stands in a field: of a class, of a literal, of what is parsed.
const text = JSON.parse('"let a1 = (b2 + 34) * c5;\\nif (a1) { x(7); }\\treturn a1; end"');
class State {
  constructor(src) {
    this.src = src;
    this.pos = 0;
    this.max = src.length;
  }
}
function count(s) {
  let n = 0;
  for (let i = s.pos; i < s.max; i++) if (s.src[i] === ";") n++;
  return n;
}
function find(s) {
  let pos = s.pos;
  while (pos < s.max && s.src[pos] !== "\t") pos++;
  return pos;
}
function braces(s) {
  let pos = s.pos,
    n = 0;
  while (pos < s.max) {
    const c = s.src.charCodeAt(pos);
    if (c === 40 || c === 41) n++;
    pos++;
  }
  return n;
}
function lines(s) {
  let n = 0;
  while (s.pos < s.max) {
    const ch = s.src.charCodeAt(s.pos);
    if (ch === 10) n++;
    s.pos++;
  }
  s.pos = 0;
  return n;
}
function sums(s) {
  for (let i = 0; i < s.max; i++) s.sum = (s.sum | 0) + (s.src[i] === "a" ? 1 : 0);
  return s.sum;
}
function shrinks(s) {
  let n = 0;
  for (let i = 0; i < s.max; i++) {
    if (s.src[i] === "a") s.max--;
    n++;
  }
  return n + "." + s.max;
}
function changes(s) {
  let n = 0;
  for (let i = 0; i < s.max; i++) {
    if (i === 2) s.max = "5";
    if (i === 4) s.max = { valueOf: () => 7 + n++ };
    n++;
    if (n > 40) break;
  }
  return n;
}
let heard = 0;
const bounds = [text.length, 0, 1, 2.5, -1, NaN, "9", "x", null, undefined, true, 6n, 2147483648, { valueOf: () => (heard++, 12) }];
const makers = [
  max => Object.assign(new State(text), { max }),
  max => ({ src: text, pos: 0, max, sum: 0 }),
  max => ({ max, pos: 0, src: [...text] }),
  max => Object.assign(JSON.parse('{"pos":0,"max":3,"src":"a;b\\t(a)"}'), { max: typeof max === "number" ? Math.min(max, 7) : max }),
  max => ({ src: text, pos: 0, get max() { heard++; return max; }, set max(value) { heard += 2; } }),
];
globalThis["state" + process.pid] = [State, count, find, braces, lines, sums, shrinks, changes];
for (const scan of [count, find, braces, lines, sums, shrinks, changes]) {
  for (const make of makers) {
    const said = [];
    for (const bound of bounds) {
      if (bound === 2147483648 && scan !== find) continue;
      try {
        said.push(String(scan(make(bound))));
      } catch (error) {
        said.push(error.constructor.name);
      }
    }
    console.log(scan.name, said.join(" "), heard);
  }
}
