// Classes of the program that have the fields of the library's error classes (name, code, errno, syscall, message), filled with strings, numbers, arrays, objects and nothing, read and stored together in loops, mixed with errors. What is printed is what plain Bun prints.
// STATISTIC: FieldTypesOfFamily <= 0
const unseen = x => [x][JSON.parse("0")];
const log = [];
const say = (...parts) => { log.push(parts.map(p => typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : Array.isArray(p) ? JSON.stringify(p) : String(p)).join(" ")); };
class Country { constructor(name, code, area) { this.name = name; this.code = code; this.area = area; } }
class Failure { constructor(name, code, errno, syscall) { this.name = name; this.code = code; this.errno = errno; this.syscall = syscall; } }
class HttpError extends Error { constructor(message, code) { super(message); this.name = "HttpError"; this.code = code; } }
class Language { constructor(code) { this.code = code; this.name = "language " + code; } }
function Word(name) { this.name = name; this.code = null; this.uses = 0; }
Word.prototype.define = function (...parts) { this.code = []; for (const part of parts) this.code.push(part); return this; };
const size = value => value === null || value === undefined ? 1 : typeof value === "number" ? value : Array.isArray(value) ? value.length * 100 : String(value).length;
function weigh(item) { return String(item.name).length + size(item.code); }
function detail(item) { return `${item.name}/${item.code}/${item.errno}/${item.syscall}/${item.message}`; }
function replaceCode(item, code) { const before = item.code; item.code = code; return before; }
function total(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += weigh(list[i]); return sum; }
function find(words, name) { for (let i = words.length - 1; i >= 0; i--) if (words[i].name === name && ++words[i].uses) return words[i]; return null; }
const countries = unseen([1, 2, 3, 4.5, -0, NaN]).map(n => new Country("c" + n, n, n * 2));
const failures = unseen(["E", 5, null, undefined, true, [1], { x: 1 }]).map((code, i) => new Failure("f" + i, code, i & 1 ? i : "E" + i, i % 3 ? "open" : 7));
const errors = unseen([404, "ENOENT", null, [1, 2]]).map((code, i) => new HttpError("m" + i, code));
const languages = unseen(["en", "de", ""]).map(code => new Language(code));
const words = unseen(["dup", "swap", "over"]).map(name => new Word(name));
words.push(new Word("square").define(1, 2, 3), new Word("cube").define(words[3], "x"));
const caught = [];
for (const run of [() => { throw new TypeError("no"); }, () => null.x, () => { throw new Failure("own", 9, 1, "read"); }, () => { throw new Country("thrown", "T", 0); }]) { try { run(); } catch (error) { caught.push(error); } }
for (let turn = 0; turn < 4; turn++) {
  for (const list of [countries, failures, errors, languages, words, [...countries, ...failures, ...errors, ...words]]) say(turn, total(list));
  for (const item of [...countries, ...failures, ...errors, ...languages, ...caught]) say(item.constructor === Country ? "Country" : "", weigh(item), item instanceof Error && !(item instanceof HttpError) ? item.name : detail(item));
  for (const name of ["dup", "cube", "square", "none"]) { const word = find(words, name); say(word && word.name, word && word.uses, word && word.code && word.code.length); }
  say(replaceCode(countries[turn], "text" + turn), replaceCode(failures[turn], turn), replaceCode(errors[turn], [turn]), replaceCode(languages[turn % 3], turn * 1.5), replaceCode(words[turn], turn & 1 ? "t" : null) === null);
  say(JSON.stringify([countries[turn], failures[turn], languages[turn % 3], Object.keys(words[turn])]));
}
console.log(log.join("\n"));
