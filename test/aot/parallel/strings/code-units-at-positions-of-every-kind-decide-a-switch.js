function Scanner(input) { this.input = String(input); this.pos = 0; this.lines = 0; }
var pp = Scanner.prototype;
pp.skipSpace = function () {
  loop: while (this.pos < this.input.length) {
    var ch = this.input.charCodeAt(this.pos);
    switch (ch) {
    case 32: case 160:
      ++this.pos;
      break;
    case 13:
      if (this.input.charCodeAt(this.pos + 1) === 10) ++this.pos;
    case 10: case 8232: case 8233:
      ++this.pos;
      ++this.lines;
      break;
    default:
      if (ch > 8 && ch < 14) ++this.pos;
      else break loop;
    }
  }
};
pp.fullCharCodeAtPos = function () {
  var code = this.input.charCodeAt(this.pos);
  if (code <= 0xd7ff || code >= 0xdc00) return code;
  var next = this.input.charCodeAt(this.pos + 1);
  return next <= 0xdbff || next >= 0xe000 ? code : (code << 10) + next - 0x35fdc00;
};
function isWordChar(code) {
  if (code < 48) return code === 36;
  if (code < 58) return true;
  if (code < 65) return false;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;
  return code > 0xffff;
}
pp.readWord = function () {
  var start = this.pos;
  while (this.pos < this.input.length) {
    var ch = this.fullCharCodeAtPos();
    if (isWordChar(ch)) this.pos += ch <= 0xffff ? 1 : 2;
    else break;
  }
  return this.input.slice(start, this.pos);
};
var text = "alpha  beta\r\ngamma $delta_9\n 😀word \ud83d tail\t\tend";
var words = [], lines = 0;
for (var turn = 0; turn < 300; turn++) {
  var scanner = new Scanner(text);
  words.length = 0;
  while (scanner.pos < scanner.input.length) {
    scanner.skipSpace();
    var word = scanner.readWord();
    if (word) words.push(word);
    else scanner.pos++;
  }
  lines += scanner.lines;
}
console.log(JSON.stringify(words), lines);

function kindOfUnit(string, position) {
  switch (string.charCodeAt(position)) {
  case 97: return "a";
  case 98: return "b";
  case 0: return "zero";
  default: return "other";
  }
}
function kindOfPoint(string, position) {
  switch (string.codePointAt(position)) {
  case 97: return "a";
  case 0x1f600: return "face";
  case undefined: return "none";
  default: return "other";
  }
}
function compared(string, position) {
  var code = string.charCodeAt(position);
  return [code < 98, code > 96, code <= 97, code >= 97, code === 97, code !== 97, code == code, code | 0, code + 1].join();
}
var positions = [0, 1, 2, 3, -1, -0, 0.5, 1.9, -0.5, NaN, Infinity, -Infinity, 4294967296, 4294967297, -4294967295, 2147483648, 1e21, undefined, null, "1", true, { valueOf: function () { return 1; } }];
for (var round = 0; round < 40; round++) {
  var out = [];
  for (var index = 0; index < positions.length; index++) {
    var at = positions[index];
    out.push(kindOfUnit("ab\0", at) + kindOfPoint("a😀", at));
  }
  if (round === 39) console.log(out.join(" "));
}
for (var index = 0; index < positions.length; index++) console.log(String(positions[index] === 0 && 1 / positions[index] < 0 ? "-0" : positions[index]), compared("ab", positions[index]));
