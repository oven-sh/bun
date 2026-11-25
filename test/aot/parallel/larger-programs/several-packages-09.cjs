// Several packages in one program: json-reader, matrix-nests, log-lines, class-kinds, layered-options, schema-check
const output = {
  lines: 0, hash: 0, first: true
};
function say() {
  const text = Array.prototype.join.call(arguments, " ");
  output.lines++;
  for (let i = 0; i < text.length; i++) output.hash = (Math.imul(output.hash,
    31) + text.charCodeAt(i)) | 0;
  if (output.first) console.log(text);
}
const jsonReader = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // a recursive reader with positions, comments allowed, reviver; and a writer with indents and cycles
    'use strict';
    function Reader(text, options) {
      this.t = text;
      this.i = 0;
      this.o = options || {
    };
      this.depth = 0;
    }
    Reader.prototype.fail = function (m) {
      var line = 1, col = 1;
      for (var k = 0; k < this.i; k++) if (this.t[k] === '\n') {
        line++;
        col = 1;
    } else col++;
      var e = new SyntaxError(m + ' at ' + line + ':' + col);
      e.line = line;
      throw e;
  };
    Reader.prototype.ws = function () {
      for (;;) {
        var c = this.t.charCodeAt(this.i);
        if (c === 32 || c === 10 || c === 13 || c === 9) {
          this.i++;
          continue;
        }
        if (this.o.comments && c === 47) {
          var n = this.t.charCodeAt(this.i + 1);
          if (n === 47) {
            while (this.i < this.t.length && this.t.charCodeAt(this.i) !== 10) this.i++;
            continue;
          }
          if (n === 42) {
            var e = this.t.indexOf('*/', this.i);
            if (e < 0) this.fail('open comment');
            this.i = e + 2;
            continue;
          }
        }
        return;
      }
  };
    Reader.prototype.value = function () {
      this.ws();
      var c = this.t[this.i];
      switch (c) {
        case '{': return this.object();
        case '[': return this.array();
        case '"': return this.string();
        case 't': return this.word('true', true);
        case 'f': return this.word('false', false);
        case 'n': return this.word('null', null);
        case undefined: return this.fail('end of text');
        default: if (c === '-' || c >= '0' && c <= '9') return this.number();
        return this.fail('unexpected ' + c);
      }
  };
    Reader.prototype.word = function (w, v) {
      if (this.t.substr(this.i, w.length) !== w) this.fail('bad word');
      this.i += w.length;
      return v;
  };
    Reader.prototype.number = function () {
      var re = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
      re.lastIndex = this.i;
      var m = re.exec(this.t);
      if (!m) this.fail('bad number');
      this.i += m[0].length;
      if (this.o.big && /^-?\d{16,}$/.test(m[0])) return BigInt(m[0]);
      return +m[0];
  };
    Reader.prototype.string = function () {
      var out = '', s = ++this.i;
      for (;;) {
        var c = this.t[this.i];
        if (c === undefined) this.fail('open string');
        if (c === '"') {
          out += this.t.slice(s, this.i++);
          return out;
        }
        if (c === '\\') {
          out += this.t.slice(s, this.i);
          var e = this.t[++this.i], k = 'bfnrt"\\/'.indexOf(e);
          if (k >= 0) out += '\b\f\n\r\t"\\/'[k];
          else if (e === 'u') {
            var h = this.t.substr(this.i + 1, 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) this.fail('bad escape');
            out += String.fromCharCode(parseInt(h, 16));
            this.i += 4;
          }
          else this.fail('bad escape');
          s = ++this.i;
          continue;
        }
        if (c < ' ') this.fail('control');
        this.i++;
      }
  };
    Reader.prototype.array = function () {
      var a = [];
      this.i++;
      if (++this.depth > 50) this.fail('too deep');
      this.ws();
      if (this.t[this.i] === ']') {
        this.i++;
        this.depth--;
        return a;
      }
      for (;;) {
        a.push(this.value());
        this.ws();
        var c = this.t[this.i++];
        if (c === ']') {
          this.depth--;
          return a;
        }
        if (c !== ',') {
          this.i--;
          this.fail('expected , or ]');
        }
        if (this.o.trailing) {
          this.ws();
          if (this.t[this.i] === ']') {
            this.i++;
            this.depth--;
            return a;
          }
        }
      }
  };
    Reader.prototype.object = function () {
      var o = {
    };
      this.i++;
      this.ws();
      if (this.t[this.i] === '}') {
        this.i++;
        return o;
      }
      for (;;) {
        this.ws();
        if (this.t[this.i] !== '"') this.fail('expected a key');
        var k = this.string();
        this.ws();
        if (this.t[this.i++] !== ':') {
          this.i--;
          this.fail('expected :');
        }
        var v = this.value();
        if (this.o.reviver) v = this.o.reviver(k, v);
        if (v !== undefined) {
          if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true });
          else o[k] = v;
        }
        this.ws();
        var c = this.t[this.i++];
        if (c === '}') return o;
        if (c !== ',') {
          this.i--;
          this.fail('expected , or }');
        }
      }
  };
    function parse(t, o) {
      var r = new Reader(t, o), v = r.value();
      r.ws();
      if (r.i < t.length) r.fail('more text');
      return v;
    }
    function quote(s) {
      var out = '"', last = 0;
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i), e = null;
        if (c === 34) e = '\\"';
        else if (c === 92) e = '\\\\';
        else if (c === 10) e = '\\n';
        else if (c === 9) e = '\\t';
        else if (c < 32 || c >= 0xd800 &&
          c <= 0xdfff) e = '\\u' + ('000' + c.toString(16)).slice(-4);
        if (e !== null) {
          out += s.slice(last, i) + e;
          last = i + 1;
        }
      }
      return out + s.slice(last) + '"';
    }
    function write(v, indent, seen, pad) {
      seen = seen || [];
      pad = pad || '';
      if (v === null) return 'null';
      switch (typeof v) {
        case 'string': return quote(v);
        case 'number': return isFinite(v) ? Object.is(v, -0) ? '0' : String(v) : 'null';
        case 'boolean': return String(v);
        case 'bigint': return String(v);
        case 'undefined': case 'function': case 'symbol': return undefined;
      }
      if (typeof v.toJSON === 'function') return write(v.toJSON(), indent, seen, pad);
      var at = seen.indexOf(v);
      if (at >= 0) return quote('cycle ' + at);
      seen.push(v);
      var inner = pad + (indent || ''), nl = indent ? '\n' : '', parts = [], s;
      if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i++) {
          s = write(v[i], indent, seen, inner);
          parts.push((s === undefined ? 'null' : s));
        }
        s = parts.length ? '[' + nl + parts.map(function (p) {
          return (indent ? inner : '') + p;
      }).join(',' + nl) + nl + (indent ? pad : '') + ']' : '[]';
    } else {
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) {
          s = write(v[k], indent, seen, inner);
          if (s !== undefined) parts.push((indent ? inner : '') + quote(k) + (indent ? ': ' : ':') + s);
        }
        s = parts.length ? '{' + nl + parts.join(',' + nl) + nl + (indent ? pad : '') + '}' : '{}';
      }
      seen.pop();
      return s;
    }
    module.exports = {
      parse: parse, write: write
  };
}).call(exports);
  return module.exports;
})();
const matrixNests = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // rows as arrays, as typed arrays, flat; in-place transposes, determinants, convolution
    'use strict';
    function zeros(r, c, Type) {
      var m = new Array(r);
      for (var i = 0; i < r; i++) {
        m[i] = Type ? new Type(c) : [];
        for (var j = 0; j < c; j++) m[i][j] = 0;
      }
      return m;
    }
    function multiply(a, b, Type) {
      var r = a.length, c = b[0].length, n = b.length, out = zeros(r, c, Type);
      for (var i = 0; i < r; i++) for (var j = 0; j < c; j++) {
        var s = 0;
        for (var k = 0; k < n; k++) s += a[i][k] * b[k][j];
        out[i][j] = s;
      }
      return out;
    }
    function transpose(m) {
      var n = m.length;
      for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
        var t = m[i][j];
        m[i][j] = m[j][i];
        m[j][i] = t;
      }
      return m;
    }
    function determinant(m) {
      var a = m.map(function (r) {
        return Array.prototype.slice.call(r);
    }), n = a.length, d = 1;
      for (var i = 0; i < n; i++) {
        var p = i;
        for (var k = i + 1; k < n; k++) if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
        if (a[p][i] === 0) return 0;
        if (p !== i) {
          var t = a[p];
          a[p] = a[i];
          a[i] = t;
          d = -d;
        }
        d *= a[i][i];
        for (k = i + 1; k < n; k++) {
          var f = a[k][i] / a[i][i];
          for (var j = i; j < n; j++) a[k][j] -= f * a[i][j];
        }
      }
      return d;
    }
    function convolve(img, w, h, kernel) {
      var out = new img.constructor(img.length), s = Math.sqrt(kernel.length) | 0, o = s >> 1;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var v = 0;
        for (var i = 0; i < s; i++) for (var j = 0; j < s; j++) {
          var yy = y + i - o, xx = x + j - o;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) v += img[yy * w + xx] * kernel[i * s + j];
        }
        out[y * w + x] = v;
      }
      return out;
    }
    function spiral(m) {
      var out = [], t = 0, b = m.length - 1, l = 0, r = m[0].length - 1, i;
      while (t <= b && l <= r) {
        for (i = l; i <= r; i++) out.push(m[t][i]);
        t++;
        for (i = t; i <= b; i++) out.push(m[i][r]);
        r--;
        if (t <= b) {
          for (i = r; i >= l; i--) out.push(m[b][i]);
          b--;
        }
        if (l <= r) {
          for (i = b; i >= t; i--) out.push(m[i][l]);
          l++;
        }
      }
      return out;
    }
    function checksum(m) {
      var s = 0;
      for (var i = 0; i < m.length; i++) for (var j = 0; j < (m[i].length ||
        0); j++) s = (s * 31 + m[i][j]) % 1000003;
      return s;
    }
    module.exports = {
      zeros: zeros, multiply: multiply, transpose: transpose, determinant: determinant,
        convolve: convolve, spiral: spiral, checksum: checksum
  };
}).call(exports);
  return module.exports;
})();
const logLines = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // lines of logs read by patterns tried in turn over a window of a larger text; fields by position, rest kept
    'use strict';
    const patterns = [   { kind: 'access',
      re: /^(\S+) (\S+) (\S+) \[([^\]]+)\] "(\S+) (\S+) ([^"]+)" (\d{3}) (\d+|-)(?: "([^"]*)" "([^"]*)")?$/,
      fields: ['host', 'ident', 'user', 'time', 'method', 'url', 'proto', 'status', 'bytes',
      'ref', 'agent'] },   { kind: 'syslog',
      re: /^<(\d{1,3})>(\w{3}\s+\d+ [\d:]+) ([\w.-]+) (\w+)(?:\[(\d+)\])?: (.*)$/,
      fields: ['pri', 'time', 'host', 'app', 'pid', 'text'] },   { kind: 'level',
      re: /^\[(DEBUG|INFO|WARN|ERROR)\](?:\s*\{(\w+)=(\w+)\})? (.*)$/, fields: ['level', 'key',
      'value', 'text'] },   { kind: 'trace',
      re: /^\s+at (?:(.+?) )?\(?(?:(.+?):(\d+):(\d+))\)?$/, fields: ['fn', 'file', 'line',
      'col'] },   { kind: 'pair', re: /^(\w+)=("(?:[^"\\]|\\.)*"|\S*)(?: (.*))?$/,
      fields: ['name', 'value', 'more'] } ];
    class Reader {
      constructor(text) {
        this.text = text;
        this.at = 0;
        this.lines = 0;
        this.counts = new Map();
        this.kept = [];
      }
      next() {
        if (this.at >= this.text.length) return null;
        let end = this.text.indexOf('\n', this.at);
        if (end < 0) end = this.text.length;
        const line = this.text.slice(this.at, end);
        this.at = end + 1;
        this.lines++;
        for (const p of patterns) {
          const m = p.re.exec(line);
          if (m === null) continue;
          const record = {
            kind: p.kind, line: this.lines
        };
          for (let i = 1; i < m.length; i++) {
            const v = m[i];
            if (v === undefined || v === '-') continue;
            record[p.fields[i - 1]] = /^\d+$/.test(v) ? Number(v) : v;
          }
          this.counts.set(p.kind, (this.counts.get(p.kind) ?? 0) + 1);
          if (record.kind === 'pair' && record.more) {
            this.kept.push(m);
            let rest = record.more, q;
            record.pairs = {
          };
            while (rest && (q = p.re.exec(rest))) {
              record.pairs[q[1]] = q[2];
              rest = q[3];
            }
          }
          return record;
        }
        return {
          kind: 'other', line: this.lines, text: line.trim()
      };
      }
      *[Symbol.iterator]() {
        for (let r; (r = this.next()) !== null;) yield r;
      }
    }
    module.exports = {
      Reader, patterns, all: text => [...new Reader(text)]
  };
}).call(exports);
  return module.exports;
})();
const classKinds = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // hierarchies over built-ins: arrays that know their kind, maps with defaults, errors with causes, promises, typed arrays, functions that are classes
    'use strict';
    class Stack extends Array {
      static get [Symbol.species]() {
        return Array;
      }
      push(...a) {
        Stack.pushed = (Stack.pushed || 0) + a.length;
        return super.push(...a);
      }
      get top() {
        return this[this.length - 1];
      }
      peek(n = 1) {
        return this.at(-n);
      }
    }
    class Vector extends Array {
      static of(...a) {
        const v = new Vector(a.length);
        a.forEach((x, i) => {
          v[i] = +x;
      });
        return v;
      }
      plus(o) {
        return this.map((x, i) => x + (typeof o === 'number' ? o : o[i] ?? 0));
      }
      dot(o) {
        return this.reduce((s, x, i) => s + x * o[i], 0);
      }
      get norm() {
        return Math.sqrt(this.dot(this));
      }
      toString() {
        return '<' + this.join(' ') + '>';
      }
    }
    class DefaultMap extends Map {
      constructor(make, it) {
        super(it);
        this.make = make;
        this.made = 0;
      }
      get(k) {
        if (!super.has(k)) {
          this.made++;
          super.set(k, this.make(k));
        }
        return super.get(k);
      }
      update(k, f) {
        return this.set(k, f(this.get(k)));
      }
      sorted(by = ([a], [b]) => a < b ? -1 : 1) {
        return new Map([...this].sort(by));
      }
      toJSON() {
        return Object.fromEntries(this);
      }
    }
    class MultiSet extends Set {
      #counts = new Map();
      add(x) {
        this.#counts?.set(x, (this.#counts.get(x) ?? 0) + 1);
        return super.add(x);
      }
      delete(x) {
        const n = this.#counts.get(x) ?? 0;
        if (n > 1) {
          this.#counts.set(x, n - 1);
          return true;
        }
        this.#counts.delete(x);
        return super.delete(x);
      }
      count(x) {
        return this.#counts.get(x) ?? 0;
      }
      get total() {
        let t = 0;
        for (const n of this.#counts.values()) t += n;
        return t;
      }
      static of(it) {
        const s = new MultiSet();
        for (const x of it) s.add(x);
        return s;
      }
    }
    class AppError extends Error {
      constructor(message, options = {}) {
        super(message, options.cause ? { cause: options.cause } : undefined);
        this.name = new.target.name;
        this.code = options.code ?? this.constructor.code;
      }
      static wrap(e, message) {
        return e instanceof this ? e : new this(message + ': ' + e.message, { cause: e });
      }
      get chain() {
        const out = [];
        for (let e = this; e; e = e.cause) out.push(e.name + (e.code ? '[' + e.code + ']' : ''));
        return out.join(' < ');
      }
      toJSON() {
        return {
          name: this.name, message: this.message, code: this.code, cause: this.cause?.message
      };
      }
    }
    class NotFound extends AppError {
      static code = 'E_NONE';
      constructor(what, o) {
        super(what + ' not found', o);
        this.what = what;
      }
    }
    class Timeout extends NotFound {
      static code = 'E_TIME';
      get message() {
        return 'timeout of ' + this.what;
      }
    }
    class Chain extends Promise {
      static made = 0;
      constructor(f) {
        super(f);
        this.constructor.made++;
      }
      tap(f) {
        return this.then(v => {
          f(v);
          return v;
      });
      }
      static get [Symbol.species]() {
        return this;
      }
    }
    class Ring extends Float64Array {
      constructor(n) {
        super(n);
        this.at_ = 0;
        this.filled = 0;
      }
      add(x) {
        this[this.at_] = x;
        this.at_ = (this.at_ + 1) % this.length;
        if (this.filled < this.length) this.filled++;
        return this;
      }
      get mean() {
        let s = 0;
        for (let i = 0; i < this.filled; i++) s += this[i];
        return this.filled ? s / this.filled : 0;
      }
      static get [Symbol.species]() {
        return Float64Array;
      }
    }
    function Callable(fn) {
      const self = function (...a) {
        return fn.apply(self, a);
    };
      Object.setPrototypeOf(self, new.target ? new.target.prototype : Callable.prototype);
      self.calls = 0;
      return self;
    }
    Callable.prototype = Object.create(Function.prototype, { constructor: { value: Callable,
      writable: true, configurable: true } });
    Callable.prototype.twice = function (x) {
      this.calls += 2;
      return this(this(x));
  };
    class Counter extends Callable {
      constructor(step) {
        super(function (x) {
          this.calls++;
          return (x || 0) + step;
      });
        this.step = step;
      }
      get info() {
        return 'step ' + this.step + ' calls ' + this.calls;
      }
    }
    const Serial = Base => class extends Base {
      static from(o) {
        return Object.assign(new this(), o);
      }
      save() {
        return JSON.stringify(this);
      }
  }, Timed = Base => class extends Base {
      #t = 0;
      tick() {
        return ++this.#t;
      }
      get time() {
        return this.#t;
      }
      static isTimed(x) {
        return #t in x;
      }
  };
    class Plain {
      constructor(a = 1) {
        this.a = a;
      }
      who() {
        return 'plain ' + this.a;
      }
    }
    class Mixed extends Serial(Timed(Plain)) {
      who() {
        return 'mixed ' + super.who() + ' t' + this.tick();
      }
    }
    module.exports = {
      Stack, Vector, DefaultMap, MultiSet, AppError, NotFound, Timeout, Chain, Ring, Callable,
        Counter, Plain, Mixed, Timed
  };
}).call(exports);
  return module.exports;
})();
const layeredOptions = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // options laid over defaults: copies made in place, getters, symbols, missing and null, order of keys, sealed ones, plugins that add their own
    'use strict';
    var defaults = {
      host: 'localhost', port: 80, retry: {
        n: 3, wait: 100
    }, tags: ['a'], debug: false, onEvent: null
  };
    var S = Symbol('inner');
    function options(user) {
      return Object.assign({}, defaults, user);
    }
    function Client(user, extra) {
      this.options = Object.assign(Object.create(Client.defaults), user);
      this.settings = Object.assign({ made: ++Client.n, kind: this.constructor.name }, extra,
        { last: true });
      this.id = Client.n;
    }
    Client.n = 0;
    Client.defaults = {
      timeout: 10, get url() {
        return (this.secure ? 'https' : 'http') + '://' + (this.host ||
          defaults.host) + ':' + (this.port || defaults.port);
    }, secure: false
  };
    Client.prototype.with = function (more) {
      var c = new this.constructor(Object.assign({}, this.options, more), { from: this.id });
      return c;
  };
    Client.prototype.json = function () {
      var o = {
    };
      for (var k in this.options) o[k] = this.options[k];
      return JSON.stringify(o);
  };
    function Deep(user) {
      var self = this;
      Object.keys(defaults).forEach(function (k) {
        var d = defaults[k], u = user && user[k];
        self[k] = u === undefined ? Array.isArray(d) ? d.slice() : d &&
          typeof d === 'object' ? {
          ...d
      } : d : d && typeof d === 'object' && !Array.isArray(d) && u ? {
          ...d, ...u
      } : u;
    });
    }
    function pick(o, keys) {
      return keys.reduce(function (a, k) {
        return k in o ? Object.assign(a, { [k]: o[k] }) : a;
    }, {});
    }
    function omit(o) {
      var out = {
        ...o
    };
      for (var i = 1; i < arguments.length; i++) delete out[arguments[i]];
      return out;
    }
    function order(o) {
      return Reflect.ownKeys(o).map(String).join();
    }
    module.exports = {
      options: options, Client: Client, Deep: Deep, pick: pick, omit: omit, order: order,
        defaults: defaults, S: S
  };
}).call(exports);
  return module.exports;
})();
const schemaCheck = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // schemas made by chained calls, compiled to closures; references, unions, transforms, paths of errors
    'use strict';
    class Issue {
      constructor(path, message) {
        this.path = path;
        this.message = message;
      }
      toString() {
        return (this.path.length ? this.path.map((p,
          i) => typeof p === 'number' ? '[' + p + ']' : (i ? '.' : '') + p).join('') + ': ' : '') + this.message;
      }
    }
    class SchemaError extends Error {
      constructor(issues) {
        super(issues.join('; '));
        this.name = 'SchemaError';
        this.issues = issues;
      }
    }
    class Type {
      constructor(def) {
        this.def = def;
        this.checks = [];
        this.steps = [];
      }
      copy(change) {
        const c = Object.create(Object.getPrototypeOf(this));
        c.def = {
          ...this.def
      };
        c.checks = this.checks.slice();
        c.steps = this.steps.slice();
        if (change) change(c);
        return c;
      }
      check(test, message) {
        return this.copy(c => c.checks.push({ test, message }));
      }
      optional() {
        return this.copy(c => {
          c.def.optional = true;
      });
      }
      nullable() {
        return this.copy(c => {
          c.def.nullable = true;
      });
      }
      default(v) {
        return this.copy(c => {
          c.def.default = v;
          c.def.hasDefault = true;
      });
      }
      transform(f) {
        return this.copy(c => c.steps.push(f));
      }
      or(o) {
        return new Union({ options: [this, o] });
      }
      run(v, path, issues) {
        if (v === undefined) {
          if (this.def.hasDefault) v = typeof this.def.default === 'function' ? this.def.default() : this.def.default;
          else if (this.def.optional) return undefined;
        }
        if (v === null && this.def.nullable) return null;
        const before = issues.length;
        let out = this.inner(v, path, issues);
        if (issues.length === before) {
          for (const { test, message } of this.checks) {
            const ok = test(out);
            if (ok !== true) issues.push(new Issue(path,
              typeof message === 'function' ? message(out) : message));
          }
        }
        if (issues.length === before) for (const f of this.steps) {
          try {
            out = f(out, path);
        } catch (e) {
            issues.push(new Issue(path, 'transform: ' + e.message));
            break;
          }
        }
        return out;
      }
      wrong(v, path, issues, what) {
        issues.push(new Issue(path,
          v === undefined ? 'required' : 'expected ' + what + ', got ' + (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)));
        return v;
      }
      safe(v) {
        const issues = [], value = this.run(v, [], issues);
        return issues.length ? {
          ok: false, issues
      } : {
          ok: true, value
      };
      }
      parse(v) {
        const r = this.safe(v);
        if (!r.ok) throw new SchemaError(r.issues);
        return r.value;
      }
    }
    class Text extends Type {
      inner(v, p, i) {
        if (this.def.coerce && v != null) v = String(v);
        return typeof v === 'string' ? this.def.trim ? v.trim() : v : this.wrong(v, p, i,
          'string');
      }
      min(n) {
        return this.check(s => s.length >= n, 'at least ' + n + ' characters');
      }
      max(n) {
        return this.check(s => s.length <= n,
          s => 'at most ' + n + ' characters, got ' + s.length);
      }
      match(re, m) {
        return this.check(s => re.test(s), m || 'must match ' + re);
      }
      trim() {
        return this.copy(c => {
          c.def.trim = true;
      });
      }
      email() {
        return this.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be an email');
      }
    }
    class Num extends Type {
      inner(v, p, i) {
        if (this.def.coerce && typeof v === 'string' && v.trim() !== '') v = +v;
        if (typeof v !== 'number' || v !== v) return this.wrong(v, p, i, 'number');
        return v;
      }
      int() {
        return this.check(Number.isInteger, 'must be an integer');
      }
      min(n) {
        return this.check(x => x >= n, 'must be >= ' + n);
      }
      max(n) {
        return this.check(x => x <= n, 'must be <= ' + n);
      }
    }
    class Bool extends Type {
      inner(v, p, i) {
        return typeof v === 'boolean' ? v : this.wrong(v, p, i, 'boolean');
      }
    }
    class Lit extends Type {
      inner(v, p, i) {
        if (this.def.values.some(x => Object.is(x, v))) return v;
        i.push(new Issue(p,
          'expected one of ' + this.def.values.map(x => JSON.stringify(x)).join(', ')));
        return v;
      }
    }
    class List extends Type {
      inner(v, p, i) {
        if (!Array.isArray(v)) return this.wrong(v, p, i, 'array');
        if (this.def.tuple) {
          if (v.length !== this.def.tuple.length) i.push(new Issue(p,
            'expected ' + this.def.tuple.length + ' items'));
          return this.def.tuple.map((t, k) => t.run(v[k], p.concat(k), i));
        }
        const out = [];
        for (let k = 0; k < v.length; k++) out.push(this.def.item.run(v[k], p.concat(k), i));
        return out;
      }
      min(n) {
        return this.check(a => a.length >= n, 'at least ' + n + ' items');
      }
      unique(key = x => x) {
        return this.check(a => new Set(a.map(key)).size === a.length, 'must be unique');
      }
    }
    class Obj extends Type {
      inner(v, p, i) {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return this.wrong(v, p, i,
          'object');
        const out = {
      };
        for (const k in this.def.shape) {
          const r = this.def.shape[k].run(v[k], p.concat(k), i);
          if (r !== undefined || k in v) out[k] = r;
        }
        if (this.def.mode !== 'strip' || this.def.rest) for (const k of Object.keys(v)) {
          if (Object.prototype.hasOwnProperty.call(this.def.shape, k)) continue;
          if (this.def.rest) out[k] = this.def.rest.run(v[k], p.concat(k), i);
          else if (this.def.mode === 'strict') i.push(new Issue(p, 'unknown key ' + k));
          else out[k] = v[k];
        }
        return out;
      }
      strict() {
        return this.copy(c => {
          c.def.mode = 'strict';
      });
      }
      loose() {
        return this.copy(c => {
          c.def.mode = 'loose';
      });
      }
      rest(t) {
        return this.copy(c => {
          c.def.rest = t;
      });
      }
      extend(s) {
        return this.copy(c => {
          c.def.shape = {
            ...c.def.shape, ...s
        };
      });
      }
      pick(...k) {
        return this.copy(c => {
          c.def.shape = Object.fromEntries(Object.entries(c.def.shape).filter(([n]) => k.includes(n)));
      });
      }
      partial() {
        return this.copy(c => {
          c.def.shape = Object.fromEntries(Object.entries(c.def.shape).map(([n, t]) => [n,
            t.optional()]));
      });
      }
    }
    class Union extends Type {
      inner(v, p, i) {
        const all = [];
        for (const o of this.def.options) {
          const mine = [];
          const r = o.run(v, p, mine);
          if (!mine.length) return r;
          all.push(mine);
        }
        const best = all.reduce((a,
          b) => Math.max(...b.map(x => x.path.length)) > Math.max(...a.map(x => x.path.length)) ? b : a);
        i.push(new Issue(p, 'no option fits (' + best.join(', ') + ')'));
        return v;
      }
      or(o) {
        return this.copy(c => {
          c.def.options = [...c.def.options, o];
      });
      }
    }
    class Lazy extends Type {
      inner(v, p, i) {
        return (this.def.type ??= this.def.make()).run(v, p, i);
      }
    }
    const s = {
      text: () => new Text({}), num: () => new Num({}), bool: () => new Bool({}),
        lit: (...values) => new Lit({ values }), list: item => new List({ item }),
        tuple: (...tuple) => new List({ tuple }), obj: shape => new Obj({ shape,
        mode: 'strip' }), union: (...options) => new Union({ options }),
        lazy: make => new Lazy({ make }), coerce: {
        num: () => new Num({ coerce: true }), text: () => new Text({ coerce: true })
      }
  };
    module.exports = {
      s, SchemaError, Issue, Type
  };
}).call(exports);
  return module.exports;
})();
function jsonReaderDocumentsRun(lib) {
  var docs = ['{"a":1,"b":[true,false,null,-0.5e2],"c":{"d":"x\\n\\u0041\\"","e":[]}}',
    '[1,2,[3,[4,[5]]]]', '"text"', '  {} ', '[1,]', '{"a" 1}', '{"a":}', '[1 2]',
    '{"k":1,"k":2}', '// c\n[1, /* in */ 2]', '12345678901234567890', '{"__proto__":{"x":1}}',
    '"\\ud83d\\ude00 \\/"', '', '[', '{"a":"\u0001"}', '01', '-', 'nul', '[1]x'];
  for (var n = 0; n < 4; n++) docs.forEach(function (d, i) {
    try {
      var v = lib.parse(n % 2 ? '\n ' + d : d, [undefined, { comments: true, trailing: true },
        { big: true }, { reviver: function (k, v) {
        return typeof v === 'number' ? v + n : v;
      }
    }][n]);
      say(n, i, lib.write(v), typeof v);
  } catch (e) {
      say(n, i, e.message, e.line);
    }
});
}
function jsonReaderWritingRun(lib) {
  var cyc = {
    name: 'c', list: []
};
  cyc.list.push(cyc, { up: cyc.list });
  var vals = [1, 'q"\\\n\t\u0007\ud800', [undefined, function () {
}, Symbol('s'), NaN, -0, 1e21], { a: undefined, b: new Date(0), c: { toJSON: function () {
    return ['j', this === vals[3].c];
  }
} }, cyc, [[], {}, [[]], { x: {} }], 10n, null, true];
  [undefined, ' ', '--'].forEach(function (ind) {
    vals.forEach(function (v, i) {
      say(i, lib.write(v, ind));
  });
});
  for (var i = 0; i < 8; i++) {
    var o = {
  };
    for (var j = 0; j <= i; j++) o['k' + (j * 3 % 5)] = j % 2 ? [j, o['k0']] : j / 4;
    var s = lib.write(o);
    say(i, s, lib.write(lib.parse(s)) === s);
  }
}
function matrixNestsKindsRun(lib) {
  var types = [null, Float64Array, Int32Array, Uint8Array, null, Float32Array, Array,
    Int8Array];
  for (var n = 2; n < 12; n++) {
    var T = types[n % types.length], a = lib.zeros(n, n, T === Array ? null : T),
      b = lib.zeros(n, n);
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      a[i][j] = (i * 7 + j * 3) % 11 - 2;
      b[i][j] = n % 3 ? i - j : (i + 1) / (j + 2);
    }
    var p = lib.multiply(a, b, T === Array ? null : T);
    say(n, T ? T.name : 'plain', lib.checksum(p), lib.determinant(b).toFixed(4),
      lib.checksum(lib.transpose(a)), lib.spiral(a).slice(0, 9).join(),
      lib.checksum(lib.multiply(p, a)));
  }
}
function matrixNestsImagesRun(lib) {
  for (var k = 0; k < 9; k++) {
    var w = 5 + k, h = 4 + k % 3, I = [Float64Array, Uint8Array, Int16Array, Uint8ClampedArray,
      Array][k % 5], img = new I(w * h);
    for (var i = 0; i < w * h; i++) img[i] = (i * i + k) % 37 + (k % 2 ? 0.5 : 0);
    var kernels = [[0, 1, 0, 1, -4, 1, 0, 1, 0], [1, 2, 1, 2, 4, 2, 1, 2, 1], [0.1, 0.1, 0.1,
      0.1, 0.2, 0.1, 0.1, 0.1, 0.1], [1]];
    kernels.forEach(function (q, n) {
      var out = lib.convolve(img, w, h, q);
      var s = 0;
      for (var i = 0; i < out.length; i++) s += out[i] * (i % 7 + 1);
      say(k, n, I.name, s.toFixed(3), Array.prototype.slice.call(out, 0, 6).map(function (x) {
        return +x.toFixed(2);
    }).join());
  });
  }
}
function logLinesMixedRun(lib) {
  const lines = ['1.2.3.4 - bob [12/Nov/2026:10:00:00 +0000] "GET /x?y=1 HTTP/1.1" 200 512 "http://r.example/" "agent/1.0 (x)"',
    '::1 - - [x] "POST / HTTP/2" 404 -', '<34>Nov  1 10:00:00 host app[123]: started in 5 ms',
    '<7>Nov 12 1:2:3 h-1.x cron: tick', '[INFO] hello', '[ERROR]{id=42} bad thing',
    '    at run (/a/b.js:10:5)', '    at /c.js:1:2', 'a=1 b="two words" c=', 'name="x\\"y"',
    'plain text', '', '[FATAL] no'];
  for (let n = 0; n < 4; n++) {
    const text = lines.map((l, i) => n ? l.replace(/\d+/g,
      d => String(+d + n * i)) : l).join('\n') + (n % 2 ? '\n' : '');
    const r = new lib.Reader(text);
    for (const x of r) say(JSON.stringify(x));
    say(JSON.stringify([...r.counts]),
      r.kept.map(m => m.slice(1).join('~') + m.index + m.input.length).join(' '));
  }
}
function logLinesLongRunRun(lib) {
  let text = '';
  for (let i = 0; i < 400; i++) text += ['[WARN]{n=' + i + '} value ' + i * i,
    'k' + i + '=' + i + ' z="q ' + i + '"', '<' + i % 190 + '>Nov 1 0:0:' + i + ' h a: t' + i,
    '10.0.0.' + i % 255 + ' - u' + i + ' [t] "PUT /p/' + i + ' H" ' + (200 + i % 300) + ' ' + i * 10][i % 4] + '\n';
  const sums = {
};
  let n = 0;
  for (const r of new lib.Reader(text)) {
    const s = sums[r.kind] ??= {
      n: 0, t: 0, keys: new Set()
  };
    s.n++;
    for (const k in r) {
      s.keys.add(k);
      if (typeof r[k] === 'number') s.t += r[k];
      else if (typeof r[k] === 'string') s.t += r[k].length;
    }
    if (n++ % 57 === 0) say(JSON.stringify(r));
  }
  for (const k in sums) say(k, sums[k].n, sums[k].t, [...sums[k].keys].join());
  say(lib.all(text.slice(100, 400)).map(r => r.kind + r.line).join());
}
function logLinesPatternsChangeRun(lib) {
  const seen = [];
  for (let i = 0; i < 20; i++) {
    if (i === 4) lib.patterns.unshift({ kind: 'num', re: /^(\d+)(?:\.(\d+))?$/, fields: ['int',
      'frac'] });
    if (i === 9) lib.patterns[0].fields = ['whole', 'part'];
    if (i === 14) lib.patterns.shift();
    const r = lib.all(['12.5', '7', '[INFO] 12', 'x=12 y=13', '1.2.3'].map(t => t.replace('2',
      i)).join('\n'));
    seen.push(r.map(x => x.kind[0]).join(''));
    say(i, JSON.stringify(r));
  }
  say(seen.join());
}
function classKindsCollectionsRun(lib) {
  const s = new lib.Stack(), v = lib.Vector.of(3, '4'), d = new lib.DefaultMap(k => [k],
    [['pre', ['x']]]), m = lib.MultiSet.of('abracadabra');
  for (let i = 0; i < 20; i++) {
    const r = s.push(i, 'i' + i);
    const w = v.plus(i % 2 ? i : [i, 1]);
    d.get('k' + i % 4).push(i);
    if (i % 5 === 4) d.update('k1', a => a.slice(-2));
    if (i % 3 === 0) m.add(i);
    else m.delete('abcdr'[i % 5]);
    say(i, r, s.top, s.peek(2), s.filter(x => typeof x === 'number') instanceof lib.Stack,
      s.slice(-2).constructor.name, lib.Stack.pushed, String(w), w instanceof lib.Vector,
      w.norm.toFixed(4), w.dot(v), d.made, d.size, JSON.stringify(d), m.size, m.total,
      m.count('a'), [...m].join(''));
    if (i === 10) s.length = 3;
  }
  say([...d.sorted().keys()].join(), Array.isArray(v), new lib.Stack(3).length,
    lib.Vector.from([1, 2]) instanceof lib.Vector, s.concat([1]).constructor === Array,
    JSON.stringify(lib.Vector.of(1, 2)), lib.MultiSet.of([NaN, NaN, -0, 0]).count(0));
}
function classKindsErrorsRun(lib) {
  const make = [() => new lib.AppError('plain'), () => new lib.NotFound('thing'),
    () => new lib.Timeout('job', { cause: new RangeError('inner') }),
    () => lib.NotFound.wrap(new TypeError('t'), 'wrapped'),
    () => lib.AppError.wrap(new lib.Timeout('x'), 'kept'), () => new lib.AppError('c',
    { code: 0, cause: new lib.NotFound('deep', { cause: new Error('root') }) })];
  for (let i = 0; i < 12; i++) {
    let e;
    try {
      throw make[i % 6]();
  } catch (x) {
      e = x;
    }
    if (i === 6) lib.NotFound.code = 'CHANGED';
    if (i === 8) lib.AppError.prototype.extra = 'late';
    say(i, e.name, e.message, e.code, e.chain, e instanceof lib.NotFound, e instanceof Error,
      JSON.stringify(e), String(e), Object.keys(e).join(), e.extra, e.stack.split('\n')[0],
      Object.prototype.toString.call(e));
  }
}
function layeredOptionsCopiesRun(lib) {
  var users = [undefined, {}, { port: 0 }, { host: null, extra: 1 }, { port: undefined,
    debug: true }, 'str', [1, 2], { get lazy() {
    return this.port + 1;
}, port: 5 }, Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true },
  hidden: { value: 3 } }), { [lib.S]: 'sym', 2: 'two', 1: 'one', b: 0 }, new Map([[1, 2]]), 7,
  null, { __proto__: { p: 1 }, retry: { n: 9 } }, { toString: function () {
    return 'ts';
  }
}];
  for (var n = 0; n < 3; n++) users.forEach(function (u, i) {
    var o = lib.options(u), d;
    try {
      d = new lib.Deep(u);
  } catch (e) {
      d = e.name;
    }
    say(n, i, JSON.stringify(o), lib.order(o), o[lib.S], o.retry === lib.defaults.retry,
      JSON.stringify(d), lib.order(lib.omit(o, 'port', 'host', 1)), JSON.stringify(lib.pick(o,
      ['port', 'tags', 'p', 'own'])), o.p);
    if (n === 1 && i === 7) {
      lib.defaults.added = n;
      lib.defaults.port = 8080;
    }
    if (n === 1 && i === 10) delete lib.defaults.debug;
});
}
function layeredOptionsClientsRun(lib) {
  var C = lib.Client;
  class Sub extends C {
    constructor(u, e) {
      super({ timeout: 5, ...u }, e);
      this.sub = {
        ...this.settings, sub: this.id
    };
    }
  }
  var list = [new C(), new Sub({ host: 'h' })];
  for (var i = 0; i < 14; i++) {
    if (i === 4) C.defaults.timeout = 99;
    if (i === 7) C.defaults.region = 'eu';
    if (i === 9) Object.defineProperty(C.defaults, 'port', { value: 1, writable: false,
      enumerable: true });
    var c = list[i % list.length], d, r;
    try {
      d = c.with(i % 3 === 0 ? { secure: true } : i % 3 === 1 ? { port: i } : { ['k' + i]: i,
        timeout: undefined });
      list.push(d);
      r = d.json();
  } catch (e) {
      r = e.name + ' ' + e.message.slice(0, 40);
    }
    say(i, r, d.options.url, d.options.timeout, JSON.stringify(d.settings),
      JSON.stringify(d.sub), lib.order(d.options), d instanceof Sub);
  }
  var f = Object.assign(Object.freeze({ a: 1 })), t;
  try {
    t = Object.assign(f, { a: 2 });
} catch (e) {
    t = e.name;
  }
  say(t, JSON.stringify(Object.assign([1, 2, 3], [9], { length: 2 })), Object.assign(5,
    { x: 1 }).x, JSON.stringify(Object.assign({}, 'ab', null, [7])), JSON.stringify({ ...'cd',
    ...null, ...[8], z: { ...{ q: 1 }, q: 2 } }));
}
function schemaCheckUsersRun(lib) {
  const {
    s
} = lib, user = s.obj({ id: s.num().int().min(1), name: s.text().trim().min(2).max(8),
  mail: s.text().email().optional(), role: s.lit('admin', 'user', 3).default('user'),
  tags: s.list(s.text()).unique().default(() => []), at: s.tuple(s.num(),
  s.num()).nullable().optional(), age: s.coerce.num().transform(n => n * 2).optional() });
  const inputs = [{ id: 1, name: ' Ann ' }, { id: 0, name: 'B' }, { id: 1.5,
    name: 'toolongname', mail: 'x' }, { id: '1', name: 5, role: 'root', tags: ['a', 'a'] },
    { id: 7, name: 'Zed', mail: 'z@z.example', role: 3, tags: ['p', 'q'], at: [1, 2],
    age: '21' }, { id: 2, name: 'Al', at: null, extra: 1 }, { id: 2, name: 'Al', at: [1],
    age: 'x' }, null, [], 'text', { id: NaN, name: undefined, at: [1, 'b'], tags: [1, null] }];
  const kinds = [user, user.strict(), user.loose(), user.partial(), user.pick('id', 'name'),
    user.extend({ extra: s.num().max(0) }), user.rest(s.bool())];
  inputs.forEach((v, i) => kinds.forEach((k, n) => {
    const r = k.safe(v);
    say(i, n, r.ok ? JSON.stringify(r.value) : r.issues.join(' | '));
}));
  try {
    user.parse({});
} catch (e) {
    say(e.name, e.message, e instanceof Error, e.issues.length);
  }
}
function schemaCheckTreesRun(lib) {
  const {
    s
} = lib;
  let made = 0;
  const node = s.lazy(() => {
    made++;
    return s.obj({ v: s.num().or(s.text()), kids: s.list(node).default([]),
      meta: s.union(s.obj({ k: s.lit('a'), n: s.num() }), s.obj({ k: s.lit('b'),
      t: s.text().min(1) })).optional() }).strict();
});
  const sum = t => (typeof t.v === 'number' ? t.v : t.v.length) + t.kids.reduce((a,
    k) => a + sum(k), 0);
  for (let i = 0; i < 18; i++) {
    let t = {
      v: i
  };
    for (let k = 0; k < i % 5; k++) t = {
      v: k % 2 ? 'n' + k : k, kids: [t, { v: k / 2, meta: k === 2 ? { k: 'b',
        t: i % 2 ? 'x' : '' } : k === 3 ? { k: 'c' } : { k: 'a', n: k } }]
  };
    if (i === 7) t.kids = [{ v: 1, other: 2 }, { v: true }];
    if (i === 12) t.kids = {
      not: 'a list'
  };
    const r = node.safe(t);
    say(i, r.ok ? sum(r.value) : r.issues.join(' | '), made);
  }
  const steps = s.coerce.num().transform(n => n + 1).transform(n => {
    if (n > 5) throw new RangeError('big ' + n);
    return 'v' + n;
});
  ['1', 2, '', '9', null, [3], true].forEach(v => {
    const r = steps.safe(v);
    say(JSON.stringify(v), r.ok ? r.value : r.issues.join());
});
}
for (let round = 0; round < 4; round++) {
  jsonReaderDocumentsRun(jsonReader);
  jsonReaderWritingRun(jsonReader);
  matrixNestsKindsRun(matrixNests);
  matrixNestsImagesRun(matrixNests);
  logLinesMixedRun(logLines);
  logLinesLongRunRun(logLines);
  logLinesPatternsChangeRun(logLines);
  classKindsCollectionsRun(classKinds);
  classKindsErrorsRun(classKinds);
  layeredOptionsCopiesRun(layeredOptions);
  layeredOptionsClientsRun(layeredOptions);
  schemaCheckUsersRun(schemaCheck);
  schemaCheckTreesRun(schemaCheck);
  output.first = false;
  console.log("round", round, output.lines, output.hash);
}
