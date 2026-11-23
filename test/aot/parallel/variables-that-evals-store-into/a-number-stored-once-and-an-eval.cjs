// One store gives the bound a number; an eval that runs late stores others.
var total = 4096, half = 8, to, from, texts = [];
function flush() {
  while (texts.length) eval(texts.pop());
}
function begin() {
  to = new Int32Array(1024);
  from = new Int32Array(1024);
  for (var i = 0; i < total / 4; i++) from[i] = i * 7;
}
function copy() {
  for (var i = 0; i < total / 4; i++) {
    to[i] = from[i];
  }
  flush();
  return to[1023] + to[half * 3 - 2];
}
function last(n) {
  return (total - 4) / 4 + n * half;
}
function sum() {
  var n = 0;
  for (var i = 0; i < total / half; i++) n = (n + to[i] + last(i)) | 0;
  return n;
}
begin();
var said = [];
for (var turn = 0; turn < 40; turn++) {
  for (var i = 0; i < 1024; i++) to[i] = turn;
  if (turn === 20) texts.push("total = 2048");
  if (turn === 24) texts.push("half = '16'");
  if (turn === 28) texts.push("total = { valueOf: function () { return 1024; } }");
  if (turn === 32) texts.push("to = [1, 2, 3]");
  if (turn === 36) texts.push("total = undefined");
  said.push(copy(), sum(), last(turn), to.length);
}
console.log(said.join(" "));
