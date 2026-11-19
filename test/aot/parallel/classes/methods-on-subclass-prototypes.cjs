// The methods of a class use names that only a subclass has: fields, and methods stored on its prototype behind the class.
// STATISTIC: ParameterGuardsSkipped >= 20
const text = JSON.parse('"alpha beta(gamma) delta + 12 epsilon zeta(eta, theta) iota kappa"');
const turns = JSON.parse("30");
let stateModule = {}, scannerModule = {}, readerModule = {};
{
  class State {
    init(options, input) { this.pos = this.line = 0; this.words = 0; this.strict = !!options.strict; this.input = input; return this; }
    clone() { const state = new State; for (const key in this) state[key] = this[key]; return state; }
  }
  stateModule = State;
}
{
  const State = stateModule;
  class Scanner {
    constructor(options, input) { this.state = new State; this.state.init(options, input); }
    code() { const c = this.input.charCodeAt(this.state.pos); if (c <= 0xd7ff || c >= 0xe000) return c; return (c << 10) + this.input.charCodeAt(this.state.pos + 1) - 0x35fdc00; }
    word() {
      const start = this.state.pos;
      while (this.state.pos < this.input.length) {
        const c = this.code();
        if (c >= 97 && c <= 122) this.state.pos += c <= 0xffff ? 1 : 2;
        else if (c === 92) this.raise(this.state.pos, "escape");
        else break;
      }
      ++this.state.words;
      return this.input.slice(start, this.state.pos);
    }
    number() { let n = 0; while (this.state.pos < this.input.length) { const c = this.code(); if (c < 48 || c > 57) break; if (n > 1e6) this.raise(this.state.pos, "number"); n = n * 10 + c - 48; ++this.state.pos; } return n; }
    next() { const c = this.code(); if (c >= 97 && c <= 122) return this.word(); if (c >= 48 && c <= 57) return this.number(); ++this.state.pos; return c; }
    lookahead() { const old = this.state; this.state = old.clone(); const next = this.next(); this.state = old; return next; }
  }
  scannerModule = Scanner;
}
{
  const Scanner = scannerModule;
  const plugins = {};
  class Reader extends Scanner {
    constructor(options, input) { super(options, input); this.input = input; this.plugins = this.load(options.plugins || []); }
    extend(name, f) { this[name] = f(this[name]); }
    load(list) { const loaded = {}; for (const name of list) { if (!loaded[name]) { loaded[name] = true; const plugin = plugins[name]; if (plugin) plugin(this); } } return loaded; }
    read() { let hash = 0; while (this.state.pos < this.input.length) { const t = this.next(); hash = (Math.imul(hash, 31) + (typeof t === "string" ? t.length * 7 + t.charCodeAt(0) : t)) | 0; } return hash; }
  }
  readerModule = Reader;
  readerModule.plugins = plugins;
}
{
  const Reader = readerModule;
  const rp = Reader.prototype;
  rp.raise = function (pos, why) { const e = new SyntaxError(`${why} at ${pos}`); e.pos = pos; throw e; };
  rp.rest = function () { return this.input.length - this.state.pos; };
}
class Run {
  turn(list) {
    const Reader = readerModule;
    const { plugins } = readerModule;
    plugins.hard = reader => reader.extend("code", old => function () { return old.call(this) | 0; });
    function read(input, options) { const reader = new Reader(options, input); try { return [reader.read(), reader.state.words, reader.rest()]; } catch (e) { return [e.name, e.message]; } }
    for (const [input, options] of list) this.out = read(input, options);
    return this.out;
  }
}
const run = new Run, said = [];
for (let t = 0; t < turns; t++) said.push(run.turn([[text, {}], [text + t, { plugins: t % 7 === 3 ? ["hard"] : [] }]]).join(" "));
console.log(said.join(", "));
for (const odd of ["abc\\d", "12 34 56", "", "x99999999999"]) console.log(run.turn([[odd, { strict: true }]]).join(" "));
const other = { state: { pos: 0, words: 0 }, input: "word here", code: scannerModule.prototype.code, raise() { return 0; } };
console.log(scannerModule.prototype.word.call(other), other.state.pos, other.state.words, new readerModule({}, "ab cd").lookahead());
try { console.log(scannerModule.prototype.word.call({ state: 1 })); } catch (e) { console.log(e.name); }
