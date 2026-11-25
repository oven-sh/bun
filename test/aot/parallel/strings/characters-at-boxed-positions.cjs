// Loops read characters at a position that a field of an escaped object holds: an integer, a double that holds one, a fraction, NaN, or a string.
function Parser(input, pos) {
  this.input = input;
  this.pos = pos;
  this.words = 0;
  this.escapes = 0;
}
globalThis.Parser = Parser;
Parser.extend = function (plugin) {
  return plugin(this);
};
const pp = Parser.prototype;
pp.escape = function () {
  this.escapes++;
};
pp.skip = function () {
  while (this.pos < this.input.length) {
    const code = this.input.charCodeAt(this.pos);
    if (code === 92) this.escape();
    else if (code !== 32 && code === code) break;
    this.pos += 1;
  }
};
pp.word = function () {
  let hash = 0;
  while (this.pos < this.input.length) {
    const code = this.input.charCodeAt(this.pos);
    if (code === 32) break;
    if (code === 92) this.escape();
    hash = (hash * 31 + code) | 0;
    this.pos += 1;
  }
  this.words++;
  return hash;
};
pp.parse = function () {
  let sum = 0;
  while (this.pos < this.input.length) {
    this.skip();
    sum = (sum + this.word()) | 0;
  }
  return `${sum} ${this.pos} ${this.words} ${this.escapes}`;
};
globalThis.parse = (parser) => parser.parse();

const Extended = Parser.extend(
  (Base) =>
    class extends Base {
      escape() {
        super.escape();
        this.escapes += 2;
      }
    },
);

const text = "alpha beta \\u gamma  delta\\ " + "café ".repeat(3) + "中😀 end";
const positions = [0, 1, 3.0, 0.5, -1, -0, NaN, "2", undefined, null, new Float64Array([4])[0], JSON.parse("5.0"), 1e10, 4294967296, Math.sqrt(9)];
for (let i = 0; i < 300; i++) {
  const position = positions[i % positions.length];
  const parser = new (i % 4 === 3 ? Extended : globalThis.Parser)(text, position);
  const answer = globalThis.parse(parser);
  if (i < positions.length * 2) console.log(String(position), answer);
}
