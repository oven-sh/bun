// A Forth: words, a dictionary that is searched backward, compiled definitions, loops, variables, strings, a return stack, errors with the word they came from, in two modules
const { ForthError, Stack, Word, Dictionary, CELL, Forth, install, library } = require("./lib.cjs");
var f = new Forth();
f.interpret(library);
var programs = ['5 square . 3 cube . 10 fact . 48 36 gcd .', '17 fib .', 'sieve .',
  '4 triangle', '1000 sum .', '27 collatz . 97 collatz .', '1 2 3 rot .s 2drop drop',
  ': test ( a -- ) 10 0 do i 3 mod 0= if i . then loop ; test', '." text " 65 emit cr',
  'variable x 5 x ! 3 x +! x @ .', '255 hex . decimal $ff . %101 .',
  ': nest 3 0 do 3 0 do i j * . loop loop ; nest',
  ': count-down begin dup . 1 - dup 0 < until drop ; 5 count-down',
  "' square 7 swap execute .", '7 constant seven seven seven * .', '100 0 do', ': bad if ;',
  'nothing', '+', '1 0 /', '1 2 .s drop drop', ': deep recurse ; deep',
  ': more 1 begin dup again ; more', '99999 @', 'forget none', '20 0 10 +loop', 'depth .',
  '1.5 2 * .', ': a ." first " ; : a a ." second " ; a forget a a'];
for (var round = 0; round < 12; round++) programs.forEach(function (p, i) {
  var before = f.out.length, said;
  try {
    f.interpret(p);
    said = f.out.slice(before);
} catch (e) {
    said = (e.name || 'Error') + ' ' + e.message;
    f.data.items.length = 0;
    f.returns.items.length = 0;
    f.depth = 0;
  }
  if (round === 0) console.log(i, JSON.stringify(said));
});
var top = f.dictionary.words.filter(function (w) {
  return w.uses > 1000;
}).sort(function (a, b) {
  return b.uses - a.uses || (a.name < b.name ? -1 : 1);
}).slice(0, 5);
console.log(top.map(function (w) {
  return w.name + ':' + w.uses;
}).join(' '), f.steps, f.dictionary.looks, f.data.deepest, f.out.length, f.memory.length);
var r = new Forth();
r.interpret(library);
r.interpret(': many 0 20000 0 do 100 random + loop ; many .');
console.log(r.out, r.steps);
