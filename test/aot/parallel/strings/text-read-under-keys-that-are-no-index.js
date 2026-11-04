// a text is read under -1, 1.5, NaN, -0, the length, 2 ** 32, "1", "01", "length", "at" and a symbol
function read(s, k) {
  return s[k];
}
function compare(s, k) {
  return [s[k] === "b", s[k] === undefined, s[k] < "c", s[k] > "a", typeof s[k]].join("/");
}
function deed() {
  const keys = [-1, 0, 1, 1.5, NaN, -0, 3, 4, 2 ** 31, 2 ** 32, 2 ** 32 - 1, -(2 ** 31), "1", "01", "1.0", "-0", "length", Symbol.iterator];
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const found = read("abc", keys[i]);
    out.push((typeof found === "function" ? "function" : String(found)) + ":" + compare("abc", keys[i]));
  }
  return out.join(" ");
}
console.log(deed());
for (let i = 0; i < 30; i++) deed();
console.log(deed());
