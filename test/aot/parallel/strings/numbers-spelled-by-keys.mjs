// Elements of strings and arrays under texts that spell integers, fractions and names: parameters, templates, sums, in loops.
function template(t, x) { let s = ""; for (let i = 0; i < 3; i++) s += t[`${x}`]; return s; }
function sum(t, x) { let s = ""; for (let i = 0; i < 3; i++) s += t[x + ""]; return s; }
function joined(t, x) { let s = ""; for (let i = 0; i < 3; i++) s += t[`${x}${1}`]; return s; }
function text(t, x) { let s = ""; for (const k of [1, 2]) s += t[String(x)] + k; return s; }
function defaulted(t, n, x = "3") { let s = ""; for (const q of [1, 2, 3]) s += t[`${x}`]; return s; }
function list(l, x) { let s = ""; for (let i = 0; i < l.length; i++) s += l[`${x}`]; return s; }
console.log(template("abcdef", "3"), template("abc", "3"), sum("abcdef", "2"), joined("abcdefghijklmn", "1"), text("abcdef", "0"), defaulted("abcdef", 1), defaulted("", 1), list([1, 2, 3, "four"], "3"));
console.log(template("abc", "1.5"), sum("abc", "Infinity"), joined("abc", "x"), text("abc", "-0"), list([1.5, , 2], "1"), list([1, 2], "01"), template("日本語", "1"), sum("abc", "length"));
