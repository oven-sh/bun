// String.prototype.indexOf called by text made at run time: one character, several, none; starts of every kind; strings of one and of two bytes a character, ropes, pieces of strings, receivers that are no strings. And sloppy text that is called without a receiver.
const pad = process.argv.length > 99 ? " " : "";
const text = (...parts) => new Function(...parts.slice(0, -1), parts.at(-1) + pad);
const find = text("s", "c", "from", "return s.indexOf(c, from)");
const findFromStart = text("s", "c", "return s.indexOf(c)");
const findNothing = text("s", "return s.indexOf()");
const attempt = (f, ...given) => { try { return f(...given); } catch (error) { return error.constructor.name; } };
const url = "http://127.0.0.1:3000/api/projects/7/tasks?status=open&limit=5" + pad;
const strings = { url, empty: "", one: "/", wide: "café/世界?x", latin: "café?", rope: url + "/tail?" + String(process.argv.length), piece: (url + "#").slice(7, 40), undefinedText: "it is undefined here", number: 12345.5, array: ["a", "/", "b"], boxed: new String("a/b?c") };
const needles = ["/", "?", ":", "", "//", "é", "世", "x", "undefined", 5, null, undefined, "/" + pad, ("?" + url).slice(0, 1), { toString: () => "?" }];
const starts = [undefined, 0, 1, 11, 21, 22, 61, 62, 63, 1000, -1, -1000, 2147483647, -2147483648, 4294967296, 1.5, 21.9, NaN, Infinity, -Infinity, "11", null, true, { valueOf: () => 22 }];
for (let round = 0; round < 3; round++)
  for (const [name, s] of Object.entries(strings)) {
    const row = needles.map(c => starts.map(from => attempt(find, s, c, from)).join(","));
    if (round === 2) console.log(name, row.join(" | "), "|", needles.map(c => attempt(findFromStart, s, c)).join(","), "|", attempt(findNothing, s));
  }
const borrowed = text("indexOf", "receiver", "c", "try { return indexOf.call(receiver, c, 0); } catch (error) { return error.constructor.name; }");
console.log([null, undefined, 5, true, "a/b", Symbol.iterator, { toString: () => "x/y" }].map(receiver => borrowed(String.prototype.indexOf, receiver, "/")).join());
const split = text("u", "const s = u.indexOf('/', 11), qi = u.indexOf('?', s + 1); return u.substring(s, qi === -1 ? undefined : qi) + ' ' + qi");
let seen = ""; for (let i = 0; i < 300; i++) seen = split(i & 1 ? url : "http://localhost:80/health"); console.log(seen, "|", split("http://localhost:80/health"), "|", split("no slash at all"));

const sloppy = text("return this");
const strict = text("'use strict'; return this");
const holder = { sloppy, strict };
for (let round = 0; round < 3; round++) console.log(sloppy() === globalThis, sloppy.call(undefined) === globalThis, sloppy.call(null) === globalThis, typeof sloppy.call(5), typeof sloppy.call("s"), typeof sloppy.call(true), typeof sloppy.call(Symbol.iterator), typeof sloppy.call(1n), holder.sloppy() === holder, sloppy.call(holder) === holder, strict(), strict.call(null), strict.call(5), holder.strict() === holder);
const inner = text("function f() { return this; } return [f() === globalThis, f.call(undefined) === globalThis, (0, f)() === globalThis, [1].map(f)[0] === globalThis, [1].map(f, 7)[0] == 7]");
console.log(inner().join());
