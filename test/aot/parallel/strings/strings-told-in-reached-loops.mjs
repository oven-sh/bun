// A loop that no loop reaches has no version of its own for a string that names alone tell.
const parse = x => JSON.parse(JSON.stringify(x));
function words(t) {
  const out = [];
  let i = 0;
  while (i < t.length) {
    let j = i;
    while (j < t.length && t[j] !== " ") j++;
    if (j > i) out.push(t.slice(i, j));
    i = j + 1;
  }
  return out;
}
const count = t => {
  let n = 0;
  for (let i = 0; i < t.length; i++) if (t[i] === "," || t.indexOf("x", i) === i) n++;
  return n;
};
const show = v => (Array.isArray(v) ? "[" + v.map(show).join("|") + "]" : String(v));
const values = [parse("the quick  brown fox"), "", " ", "a,b,,x", parse([" ", "a", "b", " ", "c"]), [..."a b,x"], [], ["a", , " "], Object("a b"), new Uint8Array([32, 97]), { length: 2, 0: "a", 1: " ", slice: (a, b) => a + ":" + b, indexOf: () => 0 }];
for (let round = 0; round < 3; round++) {
  for (const value of values) {
    for (const f of [words, count]) {
      let out;
      try {
        out = show(f(value));
      } catch (e) {
        out = e.constructor.name;
      }
      console.log(out);
    }
  }
}
