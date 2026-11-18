// Reads of values that JSON.parse made, beside the same reads of values that the program made.
var known = { count: 3, size: 4, text: "abcdefgh" }, unknown = JSON.parse('{"n":3,"m":4,"t":"abcdefgh"}');
var knownArray = [1, 2, 3], unknownArray = JSON.parse("[1,2,3]");
var knownString = "abc" + known.count, unknownString = JSON.parse('"abc"');
var knownView = { count: 3, view: new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]) }, unknownView = JSON.parse('{"n":3}'); unknownView.t = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);
var calls = 0; function call() { calls = (calls + 1) | 0; }
const loops = {
  "a field read behind a call": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { call(); s = (s + known.count) | 0; } return s; },
  "a field of an unknown object read behind a call": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { call(); s = (s + unknown.n) | 0; } return s; },
  "the length of an array": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s = (s + knownArray.length) | 0; } return s; },
  "the length of an unknown array": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s = (s + unknownArray.length) | 0; } return s; },
  "the length of a string": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s = (s + knownString.length) | 0; } return s; },
  "the length of an unknown string": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s = (s + unknownString.length) | 0; } return s; },
  "a field written": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { known.count = i; s = i; } return s; },
  "a field of an unknown object written": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { unknown.n = i; s = i; } return s; },
  "a typed array in a field": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s = (s + knownView.view[i & 7]) | 0; } return s; },
  "a typed array in a field of an unknown object": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s = (s + unknownView.t[i & 7]) | 0; } return s; },
  "characters of a string": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s = (s + known.text[i & 7].length) | 0; } return s; },
  "characters of an unknown string": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s = (s + unknown.t[i & 7].length) | 0; } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
