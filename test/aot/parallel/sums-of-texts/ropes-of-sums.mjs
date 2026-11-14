// Sums of strings in every order are made flat by the first read of a character: deep to the left, deep to the right, balanced, with narrow and wide pieces, pieces of other strings, and empty ones.
let hash = 0, seed = 7;
const random = limit => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff), (seed >> 8) % limit);
function say(value) {
  const text = String(value);
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  hash = (hash * 7 + text.length) | 0;
}
const base = Array.from({ length: 700 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
let wideOneIn = 0;
function piece() {
  if (wideOneIn && random(wideOneIn) === 0) return "Ж" + random(10);
  switch (random(6)) {
    case 0:
      return "";
    case 1:
      return String(random(100000));
    case 2:
      return base.slice(random(600), 601 + random(90));
    case 3:
      return "é-";
    default:
      return String.fromCharCode(97 + random(26));
  }
}
const makers = [
  function fromLeft(n) {
    let s = piece();
    for (let i = 1; i < n; i++) s = s + piece();
    return s;
  },
  function fromRight(n) {
    let s = piece();
    for (let i = 1; i < n; i++) s = piece() + s;
    return s;
  },
  function balanced(n) {
    return n <= 1 ? piece() : balanced(n >> 1) + balanced(n - (n >> 1));
  },
  function around(n) {
    let s = piece();
    for (let i = 1; i < n; i += 2) s = piece() + s + piece();
    return s;
  },
  function ofFields(n) {
    const fields = (a, b, c, d) => a + ", " + b + " " + c + ":" + d + "!" + a;
    return fields(piece(), n, fields(piece(), 1.5, piece(), null), piece());
  },
];
for (const frequency of [0, 40, 5]) {
  wideOneIn = frequency;
  for (const make of makers) {
    for (let n = 1; n < 70; n++) {
      const s = make(n), t = make(1 + random(9)), longer = s + t + s;
      say(s.charCodeAt(random(s.length + 1)));
      say(longer.charCodeAt(s.length));
      say(longer.length);
      say(s + t === t + s);
      say(longer.slice(1, 30));
      say((t + s)[random(9)]);
      say(longer);
    }
  }
}
console.log(hash);
