// Several packages in one program: trie-router, sorted-tree, matrix-nests, pattern-table, moo-lexer, json-reader
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
const trieRouter = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // a radix of segments, wildcards and parameters, with backtracking
    'use strict';
    class Node {
      constructor(part) {
        this.part = part;
        this.children = Object.create(null);
        this.param = null;
        this.wild = null;
        this.handlers = null;
      }
    }
    class Trie {
      constructor(options) {
        this.root = new Node('');
        this.size = 0;
        this.caseless = !!(options && options.caseless);
      }
      add(method, pattern, value) {
        let node = this.root, names = [];
        for (const part of pattern.split('/').slice(1)) {
          if (part[0] === ':') {
            names.push(part.slice(1));
            node = node.param || (node.param = new Node(':'));
          }
          else if (part === '*') {
            names.push('*');
            node = node.wild || (node.wild = new Node('*'));
            break;
          }
          else {
            const key = this.caseless ? part.toLowerCase() : part;
            node = node.children[key] || (node.children[key] = new Node(key));
          }
        }
        (node.handlers || (node.handlers = {}))[method] = {
          value, names
      };
        this.size++;
        return this;
      }
      find(method, path) {
        const q = path.indexOf('?');
        const parts = (q < 0 ? path : path.slice(0, q)).split('/').slice(1);
        const values = [];
        const hit = this._walk(this.root, parts, 0, values, method);
        if (!hit) return null;
        const params = {
      };
        for (let i = 0; i < hit.names.length; i++) params[hit.names[i]] = values[i];
        return {
          value: hit.value, params
      };
      }
      _walk(node, parts, i, values, method) {
        if (i === parts.length) return node.handlers && (node.handlers[method] ||
          node.handlers.ANY) || null;
        const part = parts[i], next = node.children[this.caseless ? part.toLowerCase() : part];
        let hit;
        if (next && (hit = this._walk(next, parts, i + 1, values, method))) return hit;
        if (node.param && part !== '') {
          const mark = values.length;
          values.push(decodeURIComponent(part));
          if ((hit = this._walk(node.param, parts, i + 1, values, method))) return hit;
          values.length = mark;
        }
        if (node.wild) {
          const h = node.wild.handlers && (node.wild.handlers[method] ||
            node.wild.handlers.ANY);
          if (h) {
            values.push(parts.slice(i).join('/'));
            return h;
          }
        }
        return null;
      }
    }
    module.exports = Trie;
}).call(exports);
  return module.exports;
})();
const sortedTree = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // a balanced tree with ranges, iteration both ways, deletion, ranks; and a skip list that must say the same
    'use strict';
    function Tree(compare) {
      this.root = null;
      this.size = 0;
      this.compare = compare || function (a, b) {
        return a < b ? -1 : a > b ? 1 : 0;
    };
      this.turns = 0;
    }
    function N(k, v) {
      this.key = k;
      this.value = v;
      this.left = this.right = null;
      this.height = 1;
      this.count = 1;
    }
    function h(n) {
      return n ? n.height : 0;
    }
    function c(n) {
      return n ? n.count : 0;
    }
    function fix(n) {
      n.height = 1 + Math.max(h(n.left), h(n.right));
      n.count = 1 + c(n.left) + c(n.right);
      return n;
    }
    function right(n) {
      var l = n.left;
      n.left = l.right;
      l.right = fix(n);
      return fix(l);
    }
    function left(n) {
      var r = n.right;
      n.right = r.left;
      r.left = fix(n);
      return fix(r);
    }
    Tree.prototype._balance = function (n) {
      fix(n);
      var b = h(n.left) - h(n.right);
      if (b > 1) {
        this.turns++;
        if (h(n.left.left) < h(n.left.right)) n.left = left(n.left);
        return right(n);
      }
      if (b < -1) {
        this.turns++;
        if (h(n.right.right) < h(n.right.left)) n.right = right(n.right);
        return left(n);
      }
      return n;
  };
    Tree.prototype.set = function (k, v) {
      var self = this, old;
      this.root = (function go(n) {
        if (!n) {
          self.size++;
          return new N(k, v);
        }
        var d = self.compare(k, n.key);
        if (d === 0) {
          old = n.value;
          n.value = v;
          return n;
        }
        if (d < 0) n.left = go(n.left);
        else n.right = go(n.right);
        return self._balance(n);
    }(this.root));
      return old;
  };
    Tree.prototype.get = function (k) {
      var n = this.root;
      while (n) {
        var d = this.compare(k, n.key);
        if (d === 0) return n.value;
        n = d < 0 ? n.left : n.right;
      }
  };
    Tree.prototype.delete = function (k) {
      var self = this, hit = false;
      function least(n) {
        while (n.left) n = n.left;
        return n;
      }
      function cut(n) {
        if (!n.left) return n.right;
        n.left = cut(n.left);
        return self._balance(n);
      }
      this.root = (function go(n) {
        if (!n) return null;
        var d = self.compare(k, n.key);
        if (d < 0) n.left = go(n.left);
        else if (d > 0) n.right = go(n.right);
        else {
          hit = true;
          if (!n.left || !n.right) return n.left || n.right;
          var m = least(n.right);
          m.right = cut(n.right);
          m.left = n.left;
          return self._balance(m);
        }
        return self._balance(n);
    }(this.root));
      if (hit) this.size--;
      return hit;
  };
    Tree.prototype.at = function (i) {
      var n = this.root;
      while (n) {
        var l = c(n.left);
        if (i < l) n = n.left;
        else if (i === l) return n;
        else {
          i -= l + 1;
          n = n.right;
        }
      }
      return undefined;
  };
    Tree.prototype.rank = function (k) {
      var n = this.root, r = 0;
      while (n) {
        var d = this.compare(k, n.key);
        if (d <= 0) {
          if (d === 0) return r + c(n.left);
          n = n.left;
      } else {
          r += c(n.left) + 1;
          n = n.right;
        }
      }
      return r;
  };
    Tree.prototype[Symbol.iterator] = function () {
      var st = [], n = this.root;
      return {
        next: function () {
          while (n) {
            st.push(n);
            n = n.left;
          }
          if (!st.length) return {
            done: true, value: undefined
        };
          var x = st.pop();
          n = x.right;
          return {
            done: false, value: [x.key, x.value]
        };
        }
    };
  };
    Tree.prototype.range = function (a, b, f) {
      var self = this, n = 0;
      (function go(x) {
        if (!x) return;
        var lo = self.compare(x.key, a), hi = self.compare(x.key, b);
        if (lo > 0) go(x.left);
        if (lo >= 0 && hi < 0) {
          n++;
          f(x.key, x.value);
        }
        if (hi < 0) go(x.right);
    }(this.root));
      return n;
  };
    Tree.prototype.back = function* () {
      var st = [], n = this.root;
      while (n || st.length) {
        while (n) {
          st.push(n);
          n = n.right;
        }
        n = st.pop();
        yield n.key;
        n = n.left;
      }
  };
    function Skip(compare) {
      this.compare = compare || function (a, b) {
        return a < b ? -1 : a > b ? 1 : 0;
    };
      this.head = {
        next: []
    };
      this.level = 1;
      this.size = 0;
      this.seed = 1;
    }
    Skip.prototype.find = function (k, update) {
      var x = this.head;
      for (var i = this.level - 1; i >= 0; i--) {
        while (x.next[i] && this.compare(x.next[i].key, k) < 0) x = x.next[i];
        if (update) update[i] = x;
      }
      return x.next[0];
  };
    Skip.prototype.set = function (k, v) {
      var u = [], x = this.find(k, u), l = 1;
      if (x && this.compare(x.key, k) === 0) {
        var old = x.value;
        x.value = v;
        return old;
    } while ((this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff) % 4 === 0 &&
      l < 16) l++;
      while (this.level < l) u[this.level++] = this.head;
      x = {
        key: k, value: v, next: new Array(l)
    };
      for (var i = 0; i < l; i++) {
        x.next[i] = u[i].next[i];
        u[i].next[i] = x;
      }
      this.size++;
  };
    Skip.prototype.delete = function (k) {
      var u = [], x = this.find(k, u);
      if (!x || this.compare(x.key, k) !== 0) return false;
      for (var i = 0; i < this.level; i++) if (u[i].next[i] === x) u[i].next[i] = x.next[i];
      while (this.level > 1 && !this.head.next[this.level - 1]) this.level--;
      this.size--;
      return true;
  };
    Skip.prototype[Symbol.iterator] = function* () {
      for (var x = this.head.next[0]; x; x = x.next[0]) yield [x.key, x.value];
  };
    module.exports = {
      Tree: Tree, Skip: Skip
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
const patternTable = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // a table of expressions tried in turn; the groups of the first that matches are copied by index, upward and downward
    'use strict';
    var rules = [   { name: 'assign', re: /^(\w+)\s*(\+?=)\s*(.+)$/, keys: ['target', 'op',
      'value'] },   { name: 'call', re: /^(\w+(?:\.\w+)*)\((.*)\)$/, keys: ['callee',
      'args'] },   { name: 'for', re: /^for (\w+) in (\w+)(?: by (\d+))?(?: if (.+))?$/,
      keys: ['name', 'list', 'step', 'test'] },   { name: 'date',
      re: /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?(Z|[+-]\d\d:?\d\d)?)?$/,
      keys: ['y', 'm', 'd', 'h', 'min', 's', 'ms', 'z'] },   { name: 'range',
      re: /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/, keys: ['from', 'to'] },   { name: 'word',
      re: /^(\w+)$/, keys: ['word'] } ];
    function groups(m, keys) {
      var out = {
    };
      for (var i = 1; i < m.length; i++) {
        if (m[i] !== undefined) out[keys[i - 1]] = m[i];
      }
      return out;
    }
    function down(m) {
      var out = [];
      for (var i = m.length; i-- > 1;) out.push(m[i] === undefined ? '-' : m[i]);
      return out;
    }
    function match(text, list) {
      for (var r = 0; r < list.length; r++) {
        var m = list[r].re.exec(text);
        if (m) return {
          rule: list[r].name, groups: groups(m, list[r].keys), down: down(m), index: m.index,
            all: m[0]
      };
      }
      return null;
    }
    function longest(text, list) {
      var best = null;
      for (var r = 0; r < list.length; r++) {
        var m = text.match(list[r].re);
        if (m !== null && (!best || String(m[1]).length > String(best[1]).length)) best = m;
      }
      if (!best) return '';
      var n = 0;
      for (var i = 1; i < best.length; i++) n += (best[i] || '').length;
      return best[1] + '/' + n + '/' + best.length;
    }
    function Reader(list) {
      this.rules = list || rules;
      this.count = {
    };
    }
    Reader.prototype.read = function (lines) {
      var self = this, out = [];
      lines.forEach(function (l) {
        var m = match(l, self.rules);
        if (m) {
          self.count[m.rule] = (self.count[m.rule] || 0) + 1;
          out.push(m);
        }
        else out.push({ rule: 'none', groups: {}, down: [l] });
    });
      return out;
  };
    module.exports = {
      Reader: Reader, match: match, longest: longest, rules: rules
  };
}).call(exports);
  return module.exports;
})();
const mooLexer = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // one big expression with named alternatives, states, and line counting
    'use strict';
    function compile(states) {
      const all = {
    };
      for (const name of Object.keys(states)) {
        const rules = Object.keys(states[name]).map(k => Object.assign({ type: k },
          states[name][k] instanceof RegExp ||
          typeof states[name][k] === 'string' ? { match: states[name][k] } : states[name][k]));
        const source = rules.map(r => '(' + (r.match instanceof RegExp ? r.match.source : r.match.replace(/[-\/\\^$*+?.()|[\]{}]/g,
          '\\$&')) + ')').join('|');
        all[name] = {
          rules, re: new RegExp(source, 'my')
      };
      }
      return new Tokens(all, Object.keys(states)[0]);
    }
    class Tokens {
      constructor(states, start) {
        this.states = states;
        this.startState = start;
        this.reset('');
      }
      reset(text) {
        this.buffer = text;
        this.index = 0;
        this.line = 1;
        this.col = 1;
        this.stack = [];
        this.state = this.startState;
        return this;
      }
      next() {
        if (this.index >= this.buffer.length) return undefined;
        const {
          re, rules
      } = this.states[this.state];
        re.lastIndex = this.index;
        const m = re.exec(this.buffer);
        if (!m) throw new Error('invalid syntax at line ' + this.line + ' col ' + this.col + ': ' + JSON.stringify(this.buffer.slice(this.index,
          this.index + 6)));
        let rule;
        for (let i = 0; i < rules.length; i++) if (m[i + 1] !== undefined) {
          rule = rules[i];
          break;
        }
        const text = m[0];
        let nl = 0, last = 0;
        for (let i = 0; i < text.length; i++) if (text[i] === '\n') {
          nl++;
          last = i + 1;
        }
        const token = {
          type: rule.type, value: rule.value ? rule.value(text) : text, text, line: this.line,
            col: this.col, lineBreaks: nl
      };
        this.index += text.length;
        this.line += nl;
        this.col = nl ? text.length - last + 1 : this.col + text.length;
        if (rule.pop) this.state = this.stack.pop();
        else if (rule.push) {
          this.stack.push(this.state);
          this.state = rule.push;
      } else if (rule.next) this.state = rule.next;
        return token;
      }
      *[Symbol.iterator]() {
        let t;
        while ((t = this.next())) yield t;
      }
    }
    module.exports = {
      compile
  };
}).call(exports);
  return module.exports;
})();
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
function trieRouterMixedRun(lib) {
  const t = new lib({ caseless: true });
  t.add('GET', '/', 'home').add('GET', '/a/:x', 'ax').add('GET', '/a/b', 'ab').add('GET',
    '/a/:x/c', 'axc').add('GET', '/a/b/d', 'abd').add('ANY', '/files/*', 'files').add('POST',
    '/a/:x', 'post').add('GET', '/:p/:q/:r', 'pqr');
  const paths = ['/', '/a/b', '/A/B', '/a/zz', '/a/b/c', '/a/b/d', '/a/q/d', '/files/x/y/z',
    '/files/', '/x/y/z', '/x/y', '/a/%41', '/a/b/d/e', '/a/zz?b=1'];
  for (let n = 0; n < 4; n++) for (const p of paths) for (const m of n % 2 ? ['GET',
    'POST'] : ['GET']) {
    const h = t.find(m, p);
    say(n, m, p, h ? h.value + ' ' + JSON.stringify(h.params) : null);
  }
  say(t.size);
}
function trieRouterGrowsRun(lib) {
  const t = new lib();
  let found = 0;
  for (let i = 0; i < 60; i++) {
    t.add(i % 3 ? 'GET' : 'ANY', '/' + ['u', ':id', 'p' + i % 5, i % 7 ? ':k' : '*'].slice(0,
      2 + i % 3).join('/'), i);
    for (let j = 0; j <= i; j += 9) {
      const h = t.find('GET', '/u/' + j + '/p' + j % 5 + (j % 2 ? '/deep/er' : ''));
      if (h) {
        found++;
        say(i, j, h.value, JSON.stringify(h.params));
      }
    }
  }
  say(found, t.size);
}
function sortedTreeNumbersRun(lib) {
  var t = new lib.Tree(), s = new lib.Skip(), seed = 11;
  for (var i = 0; i < 240; i++) {
    seed = (seed * 48271) % 2147483647;
    var k = i < 80 ? seed % 60 : i < 160 ? (seed % 600) / 8 : -(seed % 40);
    if (i % 5 === 4) {
      var a = t.delete(k), b = s.delete(k);
      if (a !== b) say('differ', i);
  } else {
      var x = t.set(k, i), y = s.set(k, i);
      if (x !== y) say('differ set', i);
    }
    if (i % 20 === 19) {
      var sum = 0, n = t.range(-5, 30.5, function (k, v) {
        sum += k * v;
    });
      say(i, t.size, s.size, t.root.height, t.turns, s.level, n, sum, t.at(t.size >> 1).key,
        t.rank(10), t.rank(t.at(3).key), t.get(k), [...t].join() === [...s].join(),
        [...t.back()].slice(0, 5).join());
    }
  }
}
function sortedTreeTextsRun(lib) {
  var by = [undefined, function (a, b) {
    return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}, function (a, b) {
    return a.toLowerCase().localeCompare(b.toLowerCase());
}],
  words = 'the quick Brown fox jumps Over the lazy dog and THE cat sat on a Mat while it rained all day long'.split(' ');
  by.forEach(function (f, n) {
    var t = new lib.Tree(f), s = new lib.Skip(f);
    words.forEach(function (w, i) {
      var o = t.set(w, (t.get(w) || 0) + 1);
      s.set(w, i);
      if (i % 4 === 3) say(n, i, o, t.size, s.size, t.at(1).key, t.rank(w),
        t.delete(words[i - 3]), s.delete(words[i - 3]), [...s].map(function (e) {
        return e[0];
    }).join());
  });
    var m = new Map(t);
    say(n, [...m.keys()].join(), t.root.count, t.range('b', 'p', function () {
  }), [...t.back()].join());
    var [first, ...rest] = t;
    say(first.join(), rest.length);
    t.set('zzz', { n: n });
    say(JSON.stringify(t.get('zzz')), t.at(99));
});
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
function patternTableLinesRun(lib) {
  var r = new lib.Reader(), texts = ['x = 1', 'total += a * b', 'print(x, y)', 'a.b.c()',
    'for i in list', 'for k in keys by 2 if k > 3', '2026-11-12', '2026-11-12T10:20',
    '2026-01-02T03:04:05.678Z', '2026-01-02T03:04:05+0100', '1..10', '-2.5..3', 'word',
    '?? nothing', '', 'for in'];
  for (var i = 0; i < 6; i++) {
    r.read(texts.map(function (t) {
      return i ? t.replace(/\d/g, function (d) {
        return (+d + i) % 10;
    }) : t;
  })).forEach(function (m, k) {
      say(i, k, m.rule, JSON.stringify(m.groups), m.down.join('|'), m.index);
  });
    say(JSON.stringify(r.count));
  }
}
function patternTableOwnRulesRun(lib) {
  var rules = [{ name: 'a', re: /(a+)(b+)?(c)?/, keys: ['a', 'b', 'c'] }, { name: 'n',
    re: /(\d)(\d)?(\d)?(\d)?(\d)?/, keys: ['p', 'q', 'r', 's', 't'] }, { name: 'q',
    re: /"([^"]*)"|'([^']*)'|`([^`]*)`/, keys: ['double', 'single', 'back'] }];
  for (var i = 0; i < 40; i++) {
    var t = ['xaab' + i, 'aaabbbc', String(i * 37), '"say ' + i + '"', "it's 'q" + i + "'",
      '`' + i, '`' + i + '`', 'none'][i % 8], m = lib.match(t, rules);
    say(i, t, m && m.rule, m && JSON.stringify(m.groups), m && m.down.join(), m && m.index,
      lib.longest(t, i % 2 ? rules : lib.rules));
  }
}
function patternTableReplacedRun(lib) {
  var log = [], pats = [/(\w)(\d)?/g, /(?<year>\d{4})-(?<mon>\d\d)/g,
    /([aeiou])|([^aeiou\s])/gi];
  for (var i = 0; i < 18; i++) {
    var t = ['abc1 d2', '2026-11 and 1999-0' + i % 10, 'Hello World ' + i][i % 3],
      re = pats[(i * 2) % 3], m, n = 0;
    re.lastIndex = 0;
    while ((m = re.exec(t)) && n++ < 9) {
      var s = '';
      for (var k = m.length - 1; k >= 0; k--) s += (m[k] === undefined ? '.' : m[k]) + ',';
      log.push(s + m.index + (m.groups ? JSON.stringify(m.groups) : ''));
    }
    say(i, log.splice(0).join(' '));
    say(t.replace(re, function () {
      var a = [].slice.call(arguments), out = '';
      for (var q = 0; q < a.length; q++) out += typeof a[q] === 'string' ? a[q].length : typeof a[q] === 'number' ? '#' + a[q] : a[q] ? '{' + Object.keys(a[q]) + '}' : '_';
      return '<' + out + '>';
  }));
  }
}
function mooLexerTemplateStringsRun(lib) {
  const lexer = lib.compile({ main: { ws: /[ \t]+/, nl: /\n/, num: { match: /\d+(?:\.\d+)?/,
    value: Number }, name: /[a-z_]\w*/, open: { match: '`', push: 'lit' }, end: { match: '}',
    pop: true }, op: /[-+*\/=(),;]/ }, lit: { interp: { match: '${', push: 'main' },
    close: { match: '`', pop: true }, text: /(?:[^`$\\]|\\.|\$(?!\{))+/ } });
  const inputs = ['a = 1 + 2.5;', '`hi ${ name } and ${ 1 + `in ${x}` }!`',
    'x\ny = `l1\nl2 $5 ${z}`\nw', '`open', 'a # b', '', '`${}`', '}'];
  for (let n = 0; n < 5; n++) for (const t of inputs) {
    const out = [];
    try {
      for (const k of lexer.reset(n % 2 ? t + ' q' + n : t)) if (k.type !== 'ws') out.push(k.type + '=' + JSON.stringify(k.value) + '@' + k.line + ',' + k.col);
      say(n, out.join(' '));
  } catch (e) {
      say(n, out.length, e.message, lexer.state, lexer.stack.length);
    }
  }
}
function mooLexerCssLikeRun(lib) {
  const lexer = lib.compile({ top: { space: /\s+/, comment: /\/\*[^]*?\*\//,
    sel: /[.#]?[\w-]+/, comma: ',', lbrace: { match: '{', next: 'body' } },
    body: { space: /\s+/, prop: /[a-z-]+(?=\s*:)/, colon: ':',
    val: { match: /[^;{}:\s][^;{}]*/, value: s => s.trim().toUpperCase() }, semi: ';',
    rbrace: { match: '}', next: 'top' } } });
  for (let i = 0; i < 20; i++) {
    const css = ['.a' + i + ', #b { color: red; width : ' + i + 'px }',
      'p{margin:0 auto;}\n/* c\nd */ div { x:y }', 'h' + i + '{}', '.q { a: b; c }'][i % 4];
    const rules = {
  };
    let cur, prop, sels = [];
    try {
      for (const t of lexer.reset(css)) {
        if (t.type === 'sel') sels.push(t.value);
        else if (t.type === 'lbrace') {
          cur = {
        };
          for (const s of sels) rules[s] = cur;
          sels = [];
      } else if (t.type === 'prop') prop = t.value;
        else if (t.type === 'val') cur[prop] = t.value;
      }
      say(i, JSON.stringify(rules), lexer.line, lexer.col);
  } catch (e) {
      say(i, e.message);
    }
  }
}
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
for (let round = 0; round < 4; round++) {
  trieRouterMixedRun(trieRouter);
  trieRouterGrowsRun(trieRouter);
  sortedTreeNumbersRun(sortedTree);
  sortedTreeTextsRun(sortedTree);
  matrixNestsKindsRun(matrixNests);
  matrixNestsImagesRun(matrixNests);
  patternTableLinesRun(patternTable);
  patternTableOwnRulesRun(patternTable);
  patternTableReplacedRun(patternTable);
  mooLexerTemplateStringsRun(mooLexer);
  mooLexerCssLikeRun(mooLexer);
  jsonReaderDocumentsRun(jsonReader);
  jsonReaderWritingRun(jsonReader);
  output.first = false;
  console.log("round", round, output.lines, output.hash);
}
