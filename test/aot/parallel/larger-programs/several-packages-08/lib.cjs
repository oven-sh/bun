// Several packages in one program: c-lexer, log-lines, matrix-nests, written-routes, layered-options, xml-events
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
const cLexer = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // a hand-written scanner: positions, strings with escapes, numbers of every base, comments, operators by longest match
    'use strict';
    var OPS = ['>>>=', '===', '!==', '>>>', '<<=', '>>=', '**=', '...', '=>', '==', '!=', '<=',
      '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '<<', '>>', '**'];
    var WORDS = {
      'if': 1, 'else': 1, 'for': 1, 'while': 1, 'return': 1, 'function': 1, 'var': 1, 'let': 1,
        'const': 1, 'new': 1, 'typeof': 1
  };
    function Lexer(input) {
      this.input = input;
      this.pos = 0;
      this.line = 1;
      this.start = 0;
      this.tokens = [];
    }
    Lexer.prototype.error = function (m) {
      var e = new SyntaxError(m + ' at ' + this.line + ':' + (this.pos - this.start));
      e.pos = this.pos;
      throw e;
  };
    Lexer.prototype.push = function (type, value, at) {
      this.tokens.push({ type: type, value: value, line: this.line, column: at - this.start,
        index: at });
  };
    Lexer.prototype.run = function () {
      var s = this.input, n = s.length;
      while (this.pos < n) {
        var c = s.charCodeAt(this.pos), at = this.pos;
        if (c === 10) {
          this.line++;
          this.pos++;
          this.start = this.pos;
          continue;
        }
        if (c === 32 || c === 9 || c === 13) {
          this.pos++;
          continue;
        }
        if (c === 47 && s.charCodeAt(at + 1) === 47) {
          while (this.pos < n && s.charCodeAt(this.pos) !== 10) this.pos++;
          continue;
        }
        if (c === 47 && s.charCodeAt(at + 1) === 42) {
          var e = s.indexOf('*/', at + 2);
          if (e < 0) this.error('unfinished comment');
          for (var k = at; k < e; k++) if (s.charCodeAt(k) === 10) {
            this.line++;
            this.start = k + 1;
          }
          this.pos = e + 2;
          continue;
        }
        if (c >= 48 && c <= 57 || c === 46 && isDigit(s.charCodeAt(at + 1))) {
          this.number(at);
          continue;
        }
        if (c >= 97 && c <= 122 || c >= 65 && c <= 90 || c === 95 || c === 36 || c > 127) {
          while (this.pos < n && isPart(s.charCodeAt(this.pos))) this.pos++;
          var w = s.slice(at, this.pos);
          this.push(Object.prototype.hasOwnProperty.call(WORDS, w) ? 'word' : 'name', w, at);
          continue;
        }
        if (c === 34 || c === 39) {
          this.string(c, at);
          continue;
        }
        this.operator(at);
      }
      return this.tokens;
  };
    function isDigit(c) {
      return c >= 48 && c <= 57;
    }
    function isPart(c) {
      return c >= 97 && c <= 122 || c >= 65 && c <= 90 || c >= 48 && c <= 57 || c === 95 ||
        c === 36 || c > 127;
    }
    Lexer.prototype.number = function (at) {
      var m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d*(?:[eE][+-]?\d+)?)n?/.exec(this.input.slice(at,
        at + 40)), t = m[0];
      this.pos += t.length;
      var big = t.charAt(t.length - 1) === 'n', body = (big ? t.slice(0, -1) : t).replace(/_/g,
        '');
      this.push(big ? 'bigint' : 'number', big ? BigInt(body) : Number(body), at);
  };
    Lexer.prototype.string = function (q, at) {
      var out = '', s = this.input;
      this.pos++;
      for (;;) {
        if (this.pos >= s.length) this.error('unfinished string');
        var c = s.charCodeAt(this.pos++);
        if (c === q) break;
        if (c === 10) this.error('line break in a string');
        if (c !== 92) {
          out += String.fromCharCode(c);
          continue;
        }
        var e = s.charAt(this.pos++);
        switch (e) {
          case 'n': out += '\n';
          break;
          case 't': out += '\t';
          break;
          case 'u': {
            var h = s.substr(this.pos, 4);
            if (!/^[0-9a-f]{4}$/i.test(h)) this.error('bad escape');
            out += String.fromCharCode(parseInt(h, 16));
            this.pos += 4;
            break;
          }
          case 'x': out += String.fromCharCode(parseInt(s.substr(this.pos, 2), 16));
          this.pos += 2;
          break;
          case '0': out += '\0';
          break;
          default: out += e;
        }
      }
      this.push('string', out, at);
  };
    Lexer.prototype.operator = function (at) {
      for (var i = 0; i < OPS.length; i++) if (this.input.startsWith(OPS[i], at)) {
        this.pos += OPS[i].length;
        return this.push('op', OPS[i], at);
      }
      var c = this.input.charAt(at);
      if ('+-*/%=<>!&|^~?:;,.()[]{}'.indexOf(c) < 0) this.error('unexpected ' + JSON.stringify(c));
      this.pos++;
      this.push('op', c, at);
  };
    module.exports = function lex(t) {
      return new Lexer(t).run();
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
const writtenRoutes = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // routes written as expressions; the groups are read by index where they are matched, upward and downward, by name lists and by position
    var routes = [];
    function add(re, keys, name, how) {
      re.keys = keys;
      routes.push({ re: re, name: name, how: how || 'up', hits: 0 });
      return routes.length;
    }
    add(/^\/a(?:\/(\w+))?(?:\/(\w+))?$/, ['x', 'y'], 'a');
    add(/^\/b\/(\d+)(\.json)?$/, ['n', 'ext'], 'b');
    add(/^\/user\/([^/]+?)(?:\/([^/]+?))?\/?$/i, ['id', 'tab'], 'user', 'down');
    add(/^\/(\d{4})\/(\d\d)\/(\d\d)\/([\w-]+)$/, ['y', 'm', 'd', 'slug'], 'post');
    add(/^\/search(?:\/(page)\/(\d+))?(?:\/(asc|desc))?$/, ['p', 'n', 'order'], 'search',
      'both');
    add(/^\/static\/(.*)$/, ['rest'], 'static');
    function decode(v) {
      return typeof v !== 'string' || v.length === 0 ? v : decodeURIComponent(v);
    }
    function route(url) {
      var q = url.indexOf('?'), path = q < 0 ? url : url.substring(0, q);
      for (var r of routes) {
        var m = r.re.exec(path);
        if (!m) continue;
        r.hits++;
        var out = {
      };
        if (r.how !== 'down') for (var i = 1; i < m.length; i++) {
          if (m[i] !== undefined) out[r.re.keys[i - 1]] = decode(m[i]);
        }
        if (r.how !== 'up') for (var k = m.length; k-- > 1;) {
          var v = m[k];
          out['-' + r.re.keys[k - 1]] = v === undefined ? null : v;
        }
        return {
          name: r.name, params: out, path: m[0], query: q < 0 ? '' : url.slice(q + 1),
            groups: m.length - 1
      };
      }
      return null;
    }
    function Old(list) {
      this.list = list;
      this.last = null;
    }
    Old.prototype.find = function (path) {
      for (var i = 0; i < this.list.length; i++) {
        var layer = this.list[i], found = layer[0].exec(path);
        if (found !== null) {
          var args = [];
          for (var j = 1, n = found.length; j < n; j++) args.push(found[j] || layer[2]);
          this.last = found;
          return layer[1].apply(this, args.concat(path.length));
        }
      }
      return 'none ' + (this.last ? this.last[this.last.length - 1] : '');
  };
    module.exports = {
      add: add, route: route, routes: routes, Old: Old
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
const xmlEvents = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // a reader of tags as events by a state machine, a tree builder and a writer; entities, CDATA, name spaces
    'use strict';
    var S = {
  };
    ['TEXT', 'OPEN', 'NAME', 'ATTRS', 'ATTR', 'EQ', 'VALUE', 'CLOSE', 'COMMENT', 'CDATA', 'PI',
      'DOCTYPE'].forEach(function (n, i) {
      S[n] = i;
      S[i] = n;
  });
    var ENT = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"
  };
    function decode(s, strict) {
      return s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);?/g, function (m,
        e) {
        if (e[0] === '#') {
          var n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return n > 0x10ffff ? m : String.fromCodePoint(n);
        }
        if (Object.prototype.hasOwnProperty.call(ENT, e)) return ENT[e];
        if (strict) throw new Error('Invalid entity ' + m);
        return m;
    });
    }
    function Sax(strict, handlers) {
      this.strict = strict;
      this.h = handlers;
      this.state = S.TEXT;
      this.buf = '';
      this.tags = [];
      this.pos = this.line = this.col = 0;
      this.quote = '';
      this.counts = {
    };
    }
    Sax.prototype.emit = function (n, a, b) {
      this.counts[n] = (this.counts[n] || 0) + 1;
      if (this.h['on' + n]) this.h['on' + n](a, b);
  };
    Sax.prototype.error = function (m) {
      var e = new Error(m + ' at ' + this.line + ':' + this.col + ' in ' + S[this.state]);
      if (this.strict) throw e;
      this.emit('error', e);
  };
    Sax.prototype.openTag = function (selfClose) {
      var t = this.tag;
      this.emit('open', t);
      if (selfClose) this.emit('close', t.name);
      else this.tags.push(t.name);
      this.state = S.TEXT;
      this.buf = '';
  };
    Sax.prototype.closeTag = function (n) {
      var i = this.tags.lastIndexOf(n);
      if (i < 0) {
        this.error('Unmatched close ' + n);
    } else {
        if (i !== this.tags.length - 1) this.error('Unexpected close ' + n);
        while (this.tags.length > i) this.emit('close', this.tags.pop());
      }
      this.state = S.TEXT;
      this.buf = '';
  };
    Sax.prototype.text = function () {
      if (this.buf) {
        this.emit('text', decode(this.buf, this.strict));
        this.buf = '';
      }
  };
    Sax.prototype.write = function (chunk) {
      for (var i = 0; i < chunk.length; i++) {
        var c = chunk.charAt(i);
        this.pos++;
        if (c === '\n') {
          this.line++;
          this.col = 0;
      } else this.col++;
        switch (this.state) {
          case S.TEXT: if (c === '<') {
            this.text();
            this.state = S.OPEN;
        } else this.buf += c;
          continue;
          case S.OPEN: this.buf += c;
          if (c === '!' || c === '-' && /^!-?$/.test(this.buf.slice(0, -1)) ||
            /^!\[/.test(this.buf) && '![CDATA['.indexOf(this.buf) === 0) {
            if (this.buf === '!--') {
              this.state = S.COMMENT;
              this.buf = '';
          } else if (this.buf === '![CDATA[') {
              this.state = S.CDATA;
              this.buf = '';
            }
            continue;
          }
          if (this.buf[0] === '!') {
            if ('![CDATA['.indexOf(this.buf) === 0) continue;
            this.state = S.DOCTYPE;
        } else if (c === '/') {
            this.state = S.CLOSE;
            this.buf = '';
        } else if (c === '?') {
            this.state = S.PI;
            this.buf = '';
        } else if (/[A-Za-z_:]/.test(c)) this.state = S.NAME;
          else {
            this.error('Bad tag start ' + c);
            this.buf = '<' + c;
            this.state = S.TEXT;
          }
          continue;
          case S.NAME: if (/[\w:.-]/.test(c)) {
            this.buf += c;
            continue;
          }
          this.tag = {
            name: this.buf, attrs: {
            }
        };
          this.buf = '';
          if (c === '>') this.openTag(false);
          else this.state = S.ATTRS, this.slash = c === '/';
          continue;
          case S.ATTRS: if (c === '>') this.openTag(this.slash);
          else if (c === '/') this.slash = true;
          else if (/\s/.test(c)) continue;
          else {
            if (this.slash) this.error('Slash inside tag');
            this.slash = false;
            this.buf = c;
            this.state = S.ATTR;
          }
          continue;
          case S.ATTR: if (c === '=') {
            this.name = this.buf;
            this.buf = '';
            this.state = S.EQ;
        } else if (/\s/.test(c) || c === '>' || c === '/') {
            this.error('Attribute without value ' + this.buf);
            this.tag.attrs[this.buf] = this.buf;
            this.buf = '';
            if (c === '>') this.openTag(false);
            else {
              this.slash = c === '/';
              this.state = S.ATTRS;
            }
        } else this.buf += c;
          continue;
          case S.EQ: if (c === '"' || c === "'") {
            this.quote = c;
            this.state = S.VALUE;
        } else if (!/\s/.test(c)) {
            this.error('Unquoted value');
            this.quote = ' ';
            this.buf = c;
            this.state = S.VALUE;
          }
          continue;
          case S.VALUE: if (c === this.quote || this.quote === ' ' && (c === '>' ||
            c === '/')) {
            if (Object.prototype.hasOwnProperty.call(this.tag.attrs,
              this.name)) this.error('Duplicate ' + this.name);
            this.tag.attrs[this.name] = decode(this.buf, this.strict);
            this.emit('attr', this.name, this.tag.attrs[this.name]);
            this.buf = '';
            this.slash = c === '/';
            if (c === '>') this.openTag(false);
            else this.state = S.ATTRS;
        } else this.buf += c;
          continue;
          case S.CLOSE: if (c === '>') this.closeTag(this.buf.trim());
          else this.buf += c;
          continue;
          case S.COMMENT: this.buf += c;
          if (this.buf.slice(-3) === '-->') {
            this.emit('comment', this.buf.slice(0, -3));
            this.buf = '';
            this.state = S.TEXT;
          }
          continue;
          case S.CDATA: this.buf += c;
          if (this.buf.slice(-3) === ']]>') {
            this.emit('cdata', this.buf.slice(0, -3));
            this.buf = '';
            this.state = S.TEXT;
          }
          continue;
          case S.PI: this.buf += c;
          if (this.buf.slice(-2) === '?>') {
            this.emit('pi', this.buf.slice(0, -2));
            this.buf = '';
            this.state = S.TEXT;
          }
          continue;
          case S.DOCTYPE: if (c === '>') {
            this.emit('doctype', this.buf.trim());
            this.buf = '';
            this.state = S.TEXT;
        } else this.buf += c;
          continue;
        }
      }
      return this;
  };
    Sax.prototype.end = function () {
      if (this.state !== S.TEXT) this.error('Unexpected end');
      else this.text();
      if (this.tags.length) this.error('Unclosed ' + this.tags.join());
      return this;
  };
    function tree(xml, strict) {
      var root = {
        name: '#root', children: []
    }, stack = [root], errors = [], p = new Sax(strict, { onopen: function (t) {
        var n = {
          name: t.name, attrs: t.attrs, children: []
      };
        stack[stack.length - 1].children.push(n);
        stack.push(n);
    }, onclose: function () {
        if (stack.length > 1) stack.pop();
    }, ontext: function (t) {
        if (t.trim()) stack[stack.length - 1].children.push(t);
    }, oncdata: function (t) {
        stack[stack.length - 1].children.push({ cdata: t });
    }, onerror: function (e) {
        errors.push(e.message);
      }
    });
      p.write(xml).end();
      root.errors = errors;
      return root;
    }
    function write(n) {
      if (typeof n === 'string') return n.replace(/[&<>]/g, function (c) {
        return {
          '&': '&amp;', '<': '&lt;', '>': '&gt;'
      }[c];
    });
      if (n.cdata !== undefined) return '<![CDATA[' + n.cdata + ']]>';
      var inner = n.children.map(write).join('');
      if (n.name === '#root') return inner;
      var a = Object.keys(n.attrs).map(function (k) {
        return ' ' + k + '="' + n.attrs[k].replace(/["&<]/g, function (c) {
          return {
            '"': '&quot;', '&': '&amp;', '<': '&lt;'
        }[c];
      }) + '"';
    }).join('');
      return '<' + n.name + a + (inner ? '>' + inner + '</' + n.name + '>' : '/>');
    }
    module.exports = {
      Sax: Sax, tree: tree, write: write, decode: decode
  };
}).call(exports);
  return module.exports;
})();
module.exports = { output, say, cLexer, logLines, matrixNests, writtenRoutes, layeredOptions, xmlEvents };
