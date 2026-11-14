// The same loop over holders of any kind: views, arguments, objects with accessors, proxies, strings as objects.
let log = "";
function compress(s) {
  let result = "",
    count = 1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === s[i + 1]) count++;
    else {
      result += s[i] + count;
      count = 1;
    }
  }
  return result;
}
function appended(s, t) {
  let result = t;
  for (let i = 0; i < s.length; i++) {
    if (s[i] == s[i - 1]) continue;
    result = result + (s[i] + "-");
  }
  return result;
}
const holders = [
  "aaabccd",
  new String("aab"),
  ["a", "a", "b"],
  [1, 1, 2],
  [0.5, 0.5, -0, NaN, NaN],
  ["a", , "b", , ,],
  [1n, 1n, 2n],
  new Uint8Array([1, 1, 2]),
  new Float64Array([0.5, 0.5, NaN]),
  new BigInt64Array([1n, 1n]),
  Buffer.from("aab"),
  { length: 3, 0: "x", 1: "x", 2: { toString: () => ((log += "t"), "o") } },
  { length: 2, get 0() { log += "g"; return "a"; }, 1: "a" },
  { get length() { log += "l"; return log.length < 9 ? 2 : 0; }, 0: 1, 1: 2 },
  { length: "2", 0: "a", 1: "b" },
  { length: { valueOf: () => ((log += "v"), 2) }, 0: Symbol.iterator.description, 1: "b" },
  [Symbol("s"), Symbol("s")],
  [{ valueOf: () => ((log += "o"), 7) }, "a"],
  (function () { return arguments; })("p", "p", "q"),
  new Proxy(["a", "a"], { get(t, k) { log += String(k)[0]; return t[k]; } }),
  Object.setPrototypeOf(["a", , "a"], { __proto__: Array.prototype, get 1() { log += "h"; return "a"; } }),
  null,
  undefined,
  5,
  () => 1,
  "😀😀",
  "a".repeat(40) + "b".repeat(3),
];
for (let round = 0; round < 2; round++) {
  for (const holder of holders) {
    log = "";
    let out = "";
    for (const f of [compress, s => appended(s, ""), s => appended(s, 1), s => appended(s, "x")]) {
      try {
        out += " " + f(holder);
      } catch (e) {
        out += " " + e.constructor.name;
      }
    }
    console.log(out, log);
  }
}
