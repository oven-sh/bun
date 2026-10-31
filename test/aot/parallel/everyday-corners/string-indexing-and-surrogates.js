// String indexing and surrogates: compiled answers as plain.
const s = "a😀b";
console.log(
  s.length,
  [...s].length,
  s[1].length,
  s.codePointAt(1),
  s.charCodeAt(2),
  s.at(-1),
  s.slice(1, 3) === "😀",
  s.split("").length,
  Array.from(s).reverse().join(""),
  s.indexOf("b"),
  encodeURIComponent(s[0]),
  s.normalize().length,
  s.isWellFormed?.(),
  s[1].isWellFormed?.(),
);
