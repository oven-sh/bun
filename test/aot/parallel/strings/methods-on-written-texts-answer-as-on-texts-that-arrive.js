// each method of strings on written operands, against the same method on operands that nobody knows when the program is built
const arrived = JSON.parse('{"text":" a,b;Ab ","wide":"aé中😀z","lone":"a\\ud800b","empty":""}');
function written() {
  return [
    " a,b;Ab ".charCodeAt(1), " a,b;Ab ".charCodeAt(99), " a,b;Ab ".charCodeAt(-1), " a,b;Ab ".charCodeAt(NaN), " a,b;Ab ".charCodeAt(1.9),
    "aé中😀z".codePointAt(3), "aé中😀z".codePointAt(4), "aé中😀z".codePointAt(9), " a,b;Ab ".charAt(2), " a,b;Ab ".charAt(8), " a,b;Ab ".at(-2), " a,b;Ab ".at(8),
    " a,b;Ab ".indexOf("b"), " a,b;Ab ".indexOf("b", 4), " a,b;Ab ".indexOf(""), " a,b;Ab ".indexOf("", 99), " a,b;Ab ".lastIndexOf("b"), " a,b;Ab ".lastIndexOf("b", 3), " a,b;Ab ".lastIndexOf("", -1),
    " a,b;Ab ".includes(";A"), " a,b;Ab ".includes("x"), " a,b;Ab ".startsWith(" a"), " a,b;Ab ".startsWith("a", 1), " a,b;Ab ".endsWith("b "), " a,b;Ab ".endsWith("A", 6),
    "a\ud800b".isWellFormed(), "aé中😀z".isWellFormed(), "a\ud800b".toWellFormed().charCodeAt(1), " a,b;Ab ".slice(1, -1), " a,b;Ab ".slice(-3), " a,b;Ab ".slice(5, 2), "aé中😀z".slice(1, 3),
    " a,b;Ab ".substring(5, 2), " a,b;Ab ".substring(NaN, 2), " a,b;Ab ".substr(-3, 2), " a,b;Ab ".substr(2), " a,b;Ab ".trim(), " a,b;Ab ".trimStart(), " a,b;Ab ".trimEnd(),
    " a,b;Ab ".toLowerCase(), " a,b;Ab ".toUpperCase(), "ab".repeat(0), "ab".repeat(1), "ab".repeat(3), "".repeat(5), "ab".padStart(1), "ab".padStart(5), "ab".padEnd(5, "xy"), "ab".padEnd(5, ""),
  ].map(answer => JSON.stringify(answer) ?? "undefined").join(" ");
}
function computed(t, w, l, e) {
  const ab = t.slice(1, 2) + t.slice(3, 4);
  return [
    t.charCodeAt(1), t.charCodeAt(99), t.charCodeAt(-1), t.charCodeAt(NaN), t.charCodeAt(1.9),
    w.codePointAt(3), w.codePointAt(4), w.codePointAt(9), t.charAt(2), t.charAt(8), t.at(-2), t.at(8),
    t.indexOf("b"), t.indexOf("b", 4), t.indexOf(""), t.indexOf("", 99), t.lastIndexOf("b"), t.lastIndexOf("b", 3), t.lastIndexOf("", -1),
    t.includes(";A"), t.includes("x"), t.startsWith(" a"), t.startsWith("a", 1), t.endsWith("b "), t.endsWith("A", 6),
    l.isWellFormed(), w.isWellFormed(), l.toWellFormed().charCodeAt(1), t.slice(1, -1), t.slice(-3), t.slice(5, 2), w.slice(1, 3),
    t.substring(5, 2), t.substring(NaN, 2), t.substr(-3, 2), t.substr(2), t.trim(), t.trimStart(), t.trimEnd(),
    t.toLowerCase(), t.toUpperCase(), ab.repeat(0), ab.repeat(1), ab.repeat(3), e.repeat(5), ab.padStart(1), ab.padStart(5), ab.padEnd(5, "xy"), ab.padEnd(5, e),
  ].map(answer => JSON.stringify(answer) ?? "undefined").join(" ");
}
for (let turn = 0; turn < 3; turn++) {
  const one = written();
  const other = computed(arrived.text, arrived.wide, arrived.lone, arrived.empty);
  console.log(one === other, one);
}
