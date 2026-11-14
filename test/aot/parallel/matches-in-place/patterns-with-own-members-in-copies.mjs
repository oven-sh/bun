// A function that matches what it is handed is copied where the literal is known.
const flat = ["alpha-12", "beta", "", "bat", "bab", "a://b:80/c?d#e", "foo.test.ts", "  a b  ", "2026-11-10", "#a0b1c2", "abcabc", "é1", "Āb1", "x".repeat(70) + "7", "abcdefghijklmnopqrstuvwxyz"];
const ropes = flat.map((s, i) => s + String(i));
const pieces = flat.map(s => ("xy" + s + "zw").slice(2, 2 + s.length));
const all = [...flat, ...ropes, ...pieces];
function last() { return [RegExp.lastMatch, RegExp.$1, RegExp.$2, RegExp.leftContext].join("|"); }
const ofModule = /^ba/, digits = /(\d)(\d)?/, everyDigit = /(\d)/g, atPlace = /[a-c](\w)?/y;
const many = /(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)(m)(n)(o)(p)(q)/;
function Bench() {
  function Exec(re, string) { let sum = 0; re.lastIndex = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
  function parts(re, string) { const m = re.exec(string); return m ? m[0] + "," + m[1] + "@" + m.index : "none"; }
  function tests(re, string) { return re.test(string) ? 1 : 0; }
  function whole(re, string) { const m = re.exec(string); return m ? JSON.stringify(m) : "null"; }
  function from(re, string) { let n = 0; re.lastIndex = 0; for (let m; (m = re.exec(string)); ) { n += m[0].length; if (n > 50) break; } return n; }
  const begin = /^ba/, set = /[#:]/, groups = /(\w)-(\w)?(\w)?/, named = /(?<y>\d{4})-(?<m>\d\d)/, lower = /^[a-z]+$/i, sticky = /b(a)?/y;
  let changed = /a(b)?/;
  this.run = function (list) {
    let out = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      out.push(Exec(begin, s), Exec(set, s), Exec(groups, s), Exec(named, s), Exec(lower, s), Exec(sticky, s), Exec(/c(\w)(\d)?/, s), Exec(ofModule, s), Exec(digits, s), Exec(everyDigit, s), Exec(atPlace, s), Exec(many, s), Exec(changed, s));
      out.push(parts(digits, s), parts(groups, s), parts(/(.)\1/, s), tests(begin, s), tests(everyDigit, s), tests(/z$/, s), whole(named, s), whole(groups, s), from(everyDigit, s), from(atPlace, s), everyDigit.lastIndex, atPlace.lastIndex, last());
      if (i === 20) changed = /(x)(y)?/;
    }
    return out.join();
  };
}
function Hoisted() {
  function Exec(re, string) { let sum = 0; re.lastIndex = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
  this.run = run; this.length = length; this.early = early;
  function early(list) { try { let n = 0; for (const s of list) n += Exec(re0, s); return n; } catch (e) { return e.constructor.name; } }
  console.log(early(["ba"]));
  var re0 = /^ba/; var re1 = /(\w)-(\w)?(\w)?/; var re2 = /\s+/g; var re3 = /b(a)?/y; var twice = /a/; twice = /b/;
  function run(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += Exec(re0, list[i]) + 10 * Exec(re1, list[i]) + 100 * Exec(re2, list[i]) + 1000 * Exec(re3, list[i]) + Exec(twice, list[i]) / 4; return sum; }
  function length(list) { let sum = 0; for (let i = 0; i < list.length; i++) { sum += list[i].replace(re2, "").length; sum += list[i].replace(re0, "").length * 100; sum += list[i].replace(re3, "").length * 10000; } return sum; }
  this.own = function () { re2[Symbol.replace] = function (s, by) { return { length: s.length + 1000 }; }; re0.exec = function () { return null; }; };
}
const h = new Hoisted(); console.log(h.early(all), h.run(all), h.length(all)); h.own(); console.log(h.length(all), h.run(all));
const b = new Bench();
console.log(b.run(all));
console.log(b.run(flat) === b.run(flat));
function exec(re, s) { let n = 0; const a = re.exec(s); if (a) for (let i = 0; i < a.length; i++) n += a[i] ? a[i].length : 100; return n; }
function loop(list) { let n = 0; for (const s of list) n += exec(ofModule, s) + exec(digits, s) * 7 + exec(/(b)(a)|(z)/, s) * 13; return n; }
console.log(loop(all));
digits.lastIndex = "4"; console.log(loop(all), digits.lastIndex);
digits.lastIndex = { valueOf() { console.log("seen"); return 0; } }; console.log(loop(all.slice(0, 3)));
digits.lastIndex = 0; digits.compile("(b)(c)(d)?", "g"); console.log(loop(all), digits.lastIndex, last());
ofModule.compile("a"); console.log(loop(all), b.run(all.slice(3, 9)));
Object.freeze(everyDigit); try { b.run(["1"]); } catch (e) { console.log(e.name); }
