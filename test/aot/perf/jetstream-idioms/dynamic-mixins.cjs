// Classes that a table brings, and classes below mixins that a table brings. Each is walked by methods of the class that the build knows.
class Reader {
  constructor(text) { this.text = text; this.position = 0; this.line = 1; this.limit = text.length; this.depth = 0; }
  isAt(code) { return this.position < this.limit && this.text.charCodeAt(this.position) === code; }
  skip() { while (this.isAt(32)) this.position++; return this.position; }
  read() { this.skip(); this.position++; this.depth = (this.depth + this.line) & 1023; return this.depth; }
  end() { return this.position >= this.limit; }
  restart() { this.position = 0; return this; }
}
const named = Base => class Named extends Base { restart() { this.line = 2; return super.restart(); } };
const counted = Base => class Counted extends Base { count = 0; end() { return super.end(); } };
const table = { named, counted };
const classes = { Reader };
function make(base, names) { let made = classes[base]; for (const name of names) made = table[name](made); return new made("a b  c d   e f g  h i j   k l m"); }
function walk(reader, n) { let sum = 0; for (let i = 0; i < n; i++) { if (reader.end()) reader.restart(); sum = (sum + reader.read()) | 0; } return sum; }
const loops = {
  "a class from a table": n => walk(make("Reader", []), n),
  "a class below a mixin from a table": n => walk(make("Reader", ["named"]), n),
  "a class below two mixins from a table": n => walk(make("Reader", ["named", "counted"]), n),
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
