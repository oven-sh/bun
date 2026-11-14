// Two words of known characters are found at every offset of a string, up to its end, and nothing that resembles them is.
const long = /agggtaaa|tttaccct/gi, classes = /[cgt]gggtaaa|tttaccc[acg]/gi, short = /foot|ball/g, uneven = /gate|gateway/, first = /needlework|needlewoman/;
const gap = n => "acgt ~Qz\xe1".repeat(n).slice(0, n);
const out = [];
function places(re, text) {
  const found = [];
  re.lastIndex = 0;
  for (let m; (m = re.exec(text));) found.push(m.index);
  return found.join();
}
for (let n = 0; n < 44; n++) {
  for (const word of ["agggtaaa", "TTTACCCT", "aGGGTAAa", "qgggtaaa", "aggg\xf4aaa", "agggtaa", "cgggtaaa", "tttaccca"]) {
    const text = gap(n) + word + gap(n * 7 % 23);
    out.push(places(long, text), places(classes, text), text.replace(long, "<$&>").length);
  }
  for (const word of ["foot", "ball", "bal", "Foot", "foo\xf4", "fo", "gate", "gateway", "needlewoman", "needlewor"]) {
    const text = gap(n) + word + gap(n * 5 % 19) + word;
    out.push(places(short, text), text.search(uneven), first.test(text) ? 1 : 0, text.split(short).length);
  }
}
const many = (gap(37) + "agggtaaa" + gap(5) + "tttaccct").repeat(9);
out.push(places(long, many), places(long, many + "œ"), many.match(long).length, many.replace(long, "").length);
let hash = 0;
for (const part of out) for (const c of String(part) + ";") hash = (hash * 31 + c.charCodeAt(0)) | 0;
console.log(out.length, hash, places(long, many));
