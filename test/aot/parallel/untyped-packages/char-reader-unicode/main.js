// An untyped package and a program of it (unicode): reading characters: past the end, pairs of surrogates, code points, cursors that go both ways, unicode expressions
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
['Hello World 42', 'ÀÉÎ straße', '日本語 ١٢٣', '😀👍 ok', '𝒜𝓑 𝟙𝟚', '  x', ''].forEach(function (t, i) { for (var k = 0; k < 3; k++) { var s = k === 1 ? t.toUpperCase() : k === 2 ? t.normalize('NFD') : t; say(i, k, JSON.stringify(lib.classes(s)), s.length, Array.from(s).length, s.replace(/[😀👍]|𝒜/gu, '#'), JSON.stringify(s.match(/😀|👍|𝓑|[à-ü]/giu)), s.split(/(?:)/u).length, s.search(/\p{Script=Han}|\p{Script=Greek}/u), JSON.stringify(s.match(/(?<a>\p{L}+)|(?<b>.)/u)), /^.$/u.test(s.slice(0, 2)), /^.$/.test(s.slice(0, 2)), s.replace(/./gsu, function (c) { return c.length; })); } });
