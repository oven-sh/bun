// The groups of a match read under a counter: taken part or not, empty, more than a frame holds, of ropes, pieces and wide texts, with other matches in between.
const unseen = x => [x][JSON.parse("0")];
function lengths(re, text) {
  let sum = 0;
  re.lastIndex = 0;
  const found = re.exec(text);
  if (found) {
    for (let i = 0; i < found.length; i++) {
      const part = found[i];
      if (part) sum += part.length;
    }
  }
  return sum;
}
function kinds(re, text) {
  const found = re.exec(text);
  if (!found) return "-";
  let t = found.length + "@" + found.index + ":";
  for (let i = 0; i < found.length; i++) {
    const part = found[i];
    t += part === undefined ? "u" : part === "" ? "e" : part.length > 9 ? part.length : part;
    t += ",";
  }
  return t + found.input.length;
}
function ternary(re, text) {
  const found = re.exec(text);
  let t = "";
  if (found !== null) for (let i = found.length - 1; i >= 0; i--) t += (found[i] ? found[i] : "no") + (found[i] ?? "nullish") + ";";
  return t;
}
function outside(re, text) {
  const found = re.exec(text);
  let t = "";
  if (found) for (let i = -2; i < found.length + 2; i++) { const part = found[i]; t += typeof part + (part ? part.length : ""); }
  return t;
}
function between(re, other, text) {
  const found = re.exec(text);
  let t = "";
  if (found) {
    for (let i = 0; i < found.length; i++) {
      const part = found[i];
      if (part) { t += other.test(part) ? 1 : 0; t += part.replace(/[a-c]/g, "."); }
      const second = other.exec(text);
      if (second) for (let k = 0; k < second.length; k++) { const inner = second[k]; if (inner) t += inner.length; }
    }
  }
  return t;
}
function again(re, text) {
  const found = re.exec(text);
  if (!found) return 0;
  let sum = 0;
  for (let turn = 0; turn < 2; turn++) for (let i = 0; i < found.length; i++) if (found[i]) sum += found[i].charCodeAt(0);
  return sum + found[0].length;
}
function kept(re, text) {
  const found = re.exec(text);
  const list = [];
  if (found) for (let i = 0; i < found.length; i++) { const part = found[i]; if (part) list.push(part); }
  return list.join("|");
}
function guarded(re, text) {
  try {
    const found = re.exec(text);
    let t = 0;
    if (found) for (let i = 0; i < found.length; i++) { const part = found[i]; if (part === "b") throw new Error(part + i); if (part) t += part.length; }
    return t;
  } catch (error) { return error.message; }
}
const many = new RegExp("(" + Array.from({ length: 15 }, (_, i) => "a").join(")(") + ")?b");
const more = new RegExp("(" + Array.from({ length: 22 }, (_, i) => "a?").join(")(") + ")b");
const patterns = unseen([/^(a)(b)?(c*)/, /(\w+)@(\w+)(\.(\w+))?/, /(a|(b))+/, /()(x)?/, /,/, /ab/, /(?:)/, /a(?=(b))/, /(((((((a)))))))/, /(?<first>a)(?<second>b)?/, /(a)(b)?/g, /(a)|(b)/y, /([^#?]*)(\?([^#]*))?(#(.*))?/, /(😀)(b)?/u, /([Ā-￿])(x)?/, /(a)(?:(b)|(c))/i, /\d+/, many, more, /(a)/d, /^\s*(.*?)\s*$/]);
const texts = unseen(["ab", "abcc", "", "b", "x@y.z", "aXb", "aaaaaaaaaaaaaaab", "a".repeat(22) + "b", "path?query#hash", "😀b", "Āx", "AB,ab", "  in  ", ("zz" + unseen("abc") + "-" + unseen("b")), "xxabcxx".slice(2, 5), "12a34"]);
for (const text of texts) {
  const out = [];
  for (const re of patterns) {
    re.lastIndex = 0; out.push(lengths(re, text));
    re.lastIndex = 0; out.push(kinds(re, text));
    re.lastIndex = 0; out.push(ternary(re, text));
    re.lastIndex = 0; out.push(outside(re, text));
    re.lastIndex = 0; out.push(between(re, patterns[0], text));
    re.lastIndex = 0; out.push(again(re, text), kept(re, text), guarded(re, text), re.lastIndex);
  }
  console.log(out.join(" "));
}
for (const last of unseen([1, 2.5, -1, "1", null, undefined, NaN, 2 ** 31])) {
  const out = [];
  for (const re of patterns) { re.lastIndex = last; try { out.push(kinds(re, "abab"), String(re.lastIndex)); } catch (error) { out.push(error.constructor.name); } }
  console.log(out.join(" "));
}
const own = /(a)(b)?/; own.exec = () => ["x", undefined, "yy"];
console.log(lengths(own, "ab"), kept(own, "ab"));
const other = { lastIndex: 5, exec(text) { return [text, "", "q"]; } };
console.log(lengths(other, "ab"), other.lastIndex, kept(other, "cd"));
const frozen = Object.freeze(/(a)(b)?/g);
for (const act of [() => lengths(frozen, "ab"), () => kinds(frozen, "ab"), () => kinds(Object.freeze(/(a)/), "xa")]) { try { console.log(act()); } catch (error) { console.log(error.constructor.name); } }
for (const bad of unseen([undefined, null, 5, {}])) { try { console.log(lengths(bad, "ab")); } catch (error) { console.log(error.constructor.name); } try { console.log(kinds(/(null|5|undefined|o)/, bad)); } catch (error) { console.log(error.constructor.name); } }
