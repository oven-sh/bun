// Several packages in one program: fraction-kit, text-tables, sorted-tree, written-routes, handle-bars, route-tables
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
const fractionKit = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // exact fractions, big powers, primes and bases over BigInt; continued fractions and square roots
    'use strict';
    const abs = x => x < 0n ? -x : x, gcd = (a, b) => {
      a = abs(a);
      b = abs(b);
      while (b) [a, b] = [b, a % b];
      return a;
  };
    class Fraction {
      constructor(n, d = 1n) {
        if (typeof n === 'string') {
          const m = /^\s*([+-]?\d+)(?:\.(\d*))?(?:\((\d+)\))?(?:\s*\/\s*(\d+))?\s*$/.exec(n);
          if (!m) throw new SyntaxError('bad fraction ' + n);
          let num = BigInt(m[1]), den = 1n;
          const neg = m[1][0] === '-';
          if (m[2]) {
            den = 10n ** BigInt(m[2].length);
            num = num * den + (neg ? -1n : 1n) * BigInt(m[2]);
          }
          if (m[3]) {
            const k = 10n ** BigInt(m[3].length) - 1n, base = den;
            num = num * k + (neg ? -1n : 1n) * BigInt(m[3]);
            den = base * k;
          }
          if (m[4]) den *= BigInt(m[4]);
          n = num;
          d = den * BigInt(d);
      } else if (typeof n === 'number') {
          if (!Number.isFinite(n)) throw new RangeError('not finite');
          let den = 1;
          while (n % 1) {
            n *= 2;
            den *= 2;
          }
          n = BigInt(n);
          d = BigInt(d) * BigInt(den);
        }
        if (d === 0n) throw new RangeError('Division by zero');
        if (d < 0n) {
          n = -n;
          d = -d;
        }
        const g = gcd(n, d) || 1n;
        this.n = n / g;
        this.d = d / g;
        Object.freeze(this);
      }
      static of(x) {
        return x instanceof Fraction ? x : typeof x === 'bigint' ? new Fraction(x,
          1n) : new Fraction(x);
      }
      add(o) {
        o = Fraction.of(o);
        return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d);
      }
      sub(o) {
        o = Fraction.of(o);
        return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d);
      }
      mul(o) {
        o = Fraction.of(o);
        return new Fraction(this.n * o.n, this.d * o.d);
      }
      div(o) {
        o = Fraction.of(o);
        return new Fraction(this.n * o.d, this.d * o.n);
      }
      pow(k) {
        return k < 0 ? new Fraction(this.d ** BigInt(-k),
          this.n ** BigInt(-k)) : new Fraction(this.n ** BigInt(k), this.d ** BigInt(k));
      }
      cmp(o) {
        o = Fraction.of(o);
        const a = this.n * o.d, b = o.n * this.d;
        return a < b ? -1 : a > b ? 1 : 0;
      }
      floor() {
        let q = this.n / this.d;
        if (this.n % this.d < 0n) q -= 1n;
        return q;
      }
      continued(max = 20) {
        const out = [];
        let [n, d] = [this.n, this.d];
        while (d && out.length < max) {
          let q = n / d;
          if (n % d < 0n) q -= 1n;
          out.push(q);
          [n, d] = [d, n - q * d];
        }
        return out;
      }
      static convergents(list) {
        let [h0, h1, k0, k1] = [0n, 1n, 1n, 0n];
        return list.map(a => {
          [h0, h1] = [h1, a * h1 + h0];
          [k0, k1] = [k1, a * k1 + k0];
          return new Fraction(h1, k1);
      });
      }
      decimal(max = 30) {
        let out = this.n < 0n ? '-' : '';
        let n = abs(this.n);
        out += n / this.d;
        let r = n % this.d;
        if (!r) return out;
        out += '.';
        const seen = new Map(), digits = [];
        while (r && digits.length < max) {
          if (seen.has(r)) {
            const at = seen.get(r);
            return out + digits.slice(0, at).join('') + '(' + digits.slice(at).join('') + ')';
          }
          seen.set(r, digits.length);
          r *= 10n;
          digits.push(r / this.d);
          r %= this.d;
        }
        return out + digits.join('') + (r ? '...' : '');
      }
      valueOf() {
        return Number(this.n) / Number(this.d);
      }
      toString() {
        return this.d === 1n ? String(this.n) : this.n + '/' + this.d;
      }
      toJSON() {
        return {
          n: String(this.n), d: String(this.d)
      };
      }
    }
    const modpow = (b, e, m) => {
      let r = 1n;
      b = ((b % m) + m) % m;
      while (e > 0n) {
        if (e & 1n) r = r * b % m;
        b = b * b % m;
        e >>= 1n;
      }
      return r;
  };
    const inverse = (a, m) => {
      let [r0, r1, s0, s1] = [m, ((a % m) + m) % m, 0n, 1n];
      while (r1) {
        const q = r0 / r1;
        [r0, r1] = [r1, r0 - q * r1];
        [s0, s1] = [s1, s0 - q * s1];
      }
      if (r0 !== 1n) throw new RangeError(a + ' has no inverse modulo ' + m);
      return ((s0 % m) + m) % m;
  };
    const isPrime = n => {
      if (n < 2n) return false;
      for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
        if (n === p) return true;
        if (n % p === 0n) return false;
      }
      let d = n - 1n, s = 0;
      while (!(d & 1n)) {
        d >>= 1n;
        s++;
      }
      next: for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
        let x = modpow(a, d, n);
        if (x === 1n || x === n - 1n) continue;
        for (let i = 1; i < s; i++) {
          x = x * x % n;
          if (x === n - 1n) continue next;
        }
        return false;
      }
      return true;
  };
    const isqrt = n => {
      if (n < 0n) throw new RangeError('negative');
      if (n < 2n) return n;
      let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
      for (;;) {
        const y = (x + n / x) >> 1n;
        if (y >= x) return x;
        x = y;
      }
  };
    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const toBase = (n, alphabet = B58) => {
      const b = BigInt(alphabet.length);
      let s = '';
      do {
        s = alphabet[Number(n % b)] + s;
        n /= b;
    } while (n);
      return s;
  };
    const fromBase = (s, alphabet = B58) => [...s].reduce((n, c) => {
      const i = alphabet.indexOf(c);
      if (i < 0) throw new RangeError('bad digit ' + c);
      return n * BigInt(alphabet.length) + BigInt(i);
  }, 0n);
    const pi = digits => {
      const unity = 10n ** BigInt(digits + 10);
      const arctan = x => {
        let sum = unity / x, term = sum, n = 3n, sign = -1n;
        const x2 = x * x;
        while (term) {
          term /= x2;
          sum += sign * (term / n);
          sign = -sign;
          n += 2n;
        }
        return sum;
    };
      return String((4n * (4n * arctan(5n) - arctan(239n))) / 10n ** 10n);
  };
    module.exports = {
      Fraction, gcd, modpow, inverse, isPrime, isqrt, toBase, fromBase, pi
  };
}).call(exports);
  return module.exports;
})();
const textTables = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // text wrapped, aligned, boxed; differences of lines; distances; cases; a rope that is built and cut
    'use strict';
    function width(s) {
      var n = 0;
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c === 27) {
          var e = s.indexOf('m', i);
          if (e > 0) {
            i = e;
            continue;
          }
        }
        n += c >= 0x1100 && (c <= 0x115f || c >= 0x2e80 && c <= 0xa4cf || c >= 0xac00 &&
          c <= 0xd7a3 || c >= 0xff00 && c <= 0xff60) ? 2 : 1;
      }
      return n;
    }
    function pad(s, w, align) {
      var n = w - width(s);
      if (n <= 0) return s;
      if (align === 'right') return ' '.repeat(n) + s;
      if (align === 'center') {
        var l = n >> 1;
        return ' '.repeat(l) + s + ' '.repeat(n - l);
      }
      return s + ' '.repeat(n);
    }
    function wrap(text, w, o) {
      o = o || {
    };
      var out = [];
      text.split('\n').forEach(function (para) {
        var line = o.first || '', lw = width(line), empty = true;
        para.split(/(\s+)/).forEach(function (word) {
          if (/^\s*$/.test(word)) {
            if (!empty) {
              line += word;
              lw += width(word);
            }
            return;
          }
          var ww = width(word);
          while (ww > w && o.hard) {
            var cut = word.slice(0, Math.max(1, w - lw));
            out.push(line + cut);
            word = word.slice(cut.length);
            ww = width(word);
            line = o.indent || '';
            lw = width(line);
          }
          if (lw + ww > w && !empty) {
            out.push(line.replace(/\s+$/, ''));
            line = (o.indent || '') + word;
            lw = width(line);
        } else {
            line += word;
            lw += ww;
          }
          empty = false;
      });
        out.push(line.replace(/\s+$/, ''));
    });
      return out;
    }
    function table(rows, o) {
      o = o || {
    };
      var cells = rows.map(function (r) {
        return r.map(function (c) {
          return c === null || c === undefined ? [''] : String(c).split('\n');
      });
    }), widths = [], n = Math.max.apply(null, cells.map(function (r) {
        return r.length;
    })), out = [];
      for (var c = 0; c < n; c++) {
        widths[c] = 0;
        for (var r = 0; r < cells.length; r++) (cells[r][c] || ['']).forEach(function (l) {
          widths[c] = Math.max(widths[c], width(l));
      });
        if (o.max && widths[c] > o.max) {
          widths[c] = o.max;
          cells.forEach(function (row) {
            if (row[c]) row[c] = [].concat.apply([], row[c].map(function (l) {
              return wrap(l, o.max, { hard: true });
          }));
        });
        }
      }
      var rule = '+' + widths.map(function (w) {
        return '-'.repeat(w + 2);
    }).join('+') + '+';
      out.push(rule);
      cells.forEach(function (row, i) {
        var h = Math.max.apply(null, row.map(function (x) {
          return x.length;
      }).concat(1));
        for (var l = 0; l < h; l++) {
          var s = '|';
          for (var c = 0; c < n; c++) s += ' ' + pad((row[c] || [])[l] || '', widths[c],
            (o.align || [])[c]) + ' |';
          out.push(s);
        }
        if (i === 0 && o.head) out.push(rule);
    });
      out.push(rule);
      return out.join('\n');
    }
    function lcs(a, b) {
      var m = a.length, n = b.length, t = [];
      for (var i = 0; i <= m; i++) {
        t[i] = new Array(n + 1).fill(0);
      }
      for (i = m - 1; i >= 0; i--) for (var j = n - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j],
        t[i][j + 1]);
      var out = [];
      i = j = 0;
      while (i < m && j < n) {
        if (a[i] === b[j]) {
          out.push(['=', a[i]]);
          i++;
          j++;
      } else if (t[i + 1][j] >= t[i][j + 1]) out.push(['-', a[i++]]);
        else out.push(['+', b[j++]]);
    } while (i < m) out.push(['-', a[i++]]);
      while (j < n) out.push(['+', b[j++]]);
      return out;
    }
    function distance(a, b, swap) {
      var prev2, prev = [], cur;
      for (var j = 0; j <= b.length; j++) prev[j] = j;
      for (var i = 1; i <= a.length; i++) {
        cur = [i];
        for (j = 1; j <= b.length; j++) {
          var cost = a[i - 1] === b[j - 1] ? 0 : 1;
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
          if (swap && i > 1 && j > 1 && a[i - 1] === b[j - 2] &&
            a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
        }
        prev2 = prev;
        prev = cur;
      }
      return prev[b.length];
    }
    function words(s) {
      return s.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) || [];
    }
    var cases = {
      camel: function (s) {
        return words(s).map(function (w, i) {
          w = w.toLowerCase();
          return i ? w[0].toUpperCase() + w.slice(1) : w;
      }).join('');
    }, snake: function (s) {
        return words(s).join('_').toLowerCase();
    }, kebab: function (s) {
        return words(s).join('-').toLowerCase();
    }, title: function (s) {
        return s.replace(/\b(\w)(\w*)/g, function (m, a, b) {
          return a.toUpperCase() + b.toLowerCase();
      });
    }, slug: function (s) {
        return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g,
          '-').replace(/^-+|-+$/g, '');
    }, swap: function (s) {
        var o = '';
        for (var i = 0; i < s.length; i++) {
          var c = s[i], u = c.toUpperCase();
          o += c === u ? c.toLowerCase() : u;
        }
        return o;
      }
  };
    function Rope(a, b) {
      if (b === undefined) {
        this.leaf = a;
        this.length = a.length;
        this.depth = 0;
    } else {
        this.a = a;
        this.b = b;
        this.length = a.length + b.length;
        this.depth = 1 + Math.max(a.depth, b.depth);
      }
    }
    Rope.prototype.concat = function (o) {
      if (typeof o === 'string') o = new Rope(o);
      if (!o.length) return this;
      if (!this.length) return o;
      if (this.leaf !== undefined && o.leaf !== undefined &&
        this.length + o.length < 16) return new Rope(this.leaf + o.leaf);
      var r = new Rope(this, o);
      return r.depth > 12 ? r.balance() : r;
  };
    Rope.prototype.slice = function (s, e) {
      if (s <= 0 && e >= this.length) return this;
      if (s >= e) return new Rope('');
      if (this.leaf !== undefined) return new Rope(this.leaf.slice(s, e));
      var n = this.a.length;
      if (e <= n) return this.a.slice(s, e);
      if (s >= n) return this.b.slice(s - n, e - n);
      return this.a.slice(s, n).concat(this.b.slice(0, e - n));
  };
    Rope.prototype.insert = function (i, t) {
      return this.slice(0, i).concat(t).concat(this.slice(i, this.length));
  };
    Rope.prototype.charAt = function (i) {
      var r = this;
      while (r.leaf === undefined) {
        if (i < r.a.length) r = r.a;
        else {
          i -= r.a.length;
          r = r.b;
        }
      }
      return r.leaf.charAt(i);
  };
    Rope.prototype.leaves = function (out) {
      if (this.leaf !== undefined) out.push(this);
      else {
        this.a.leaves(out);
        this.b.leaves(out);
      }
      return out;
  };
    Rope.prototype.balance = function () {
      var l = this.leaves([]);
      while (l.length > 1) {
        var n = [];
        for (var i = 0; i < l.length; i += 2) n.push(i + 1 < l.length ? new Rope(l[i],
          l[i + 1]) : l[i]);
        l = n;
      }
      return l[0];
  };
    Rope.prototype.toString = function () {
      return this.leaf !== undefined ? this.leaf : this.a.toString() + this.b.toString();
  };
    module.exports = {
      width: width, pad: pad, wrap: wrap, table: table, lcs: lcs, distance: distance,
        words: words, cases: cases, Rope: Rope
  };
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
const handleBars = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // templates with blocks, partials, helpers, paths, else, inverted sections, each with index and key, whitespace control
    'use strict';
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    class Engine {
      constructor() {
        this.helpers = Object.create(null);
        this.partials = Object.create(null);
        this.cache = new Map();
        this.compiled = 0;
        this.helper('if', function (v, o) {
          return (Array.isArray(v) ? v.length : v) ? o.fn(this) : o.inverse(this);
      });
        this.helper('unless', function (v, o) {
          return (Array.isArray(v) ? v.length : v) ? o.inverse(this) : o.fn(this);
      });
        this.helper('with', function (v, o) {
          return v ? o.fn(v) : o.inverse(this);
      });
        this.helper('each', function (list, o) {
          if (!list || typeof list !== 'object') return o.inverse(this);
          const keys = Object.keys(list);
          if (!keys.length) return o.inverse(this);
          let out = '';
          keys.forEach((k, i) => {
            out += o.fn(list[k], { index: i, key: k, first: i === 0,
              last: i === keys.length - 1 }, o.as && [list[k], k]);
        });
          return out;
      });
      }
      helper(n, f) {
        this.helpers[n] = f;
        return this;
      }
      partial(n, t) {
        this.partials[n] = t;
        this.cache.delete(n);
        return this;
      }
      parse(text) {
        const re = /\{\{(~)?(?:!--([\s\S]*?)--|!([\s\S]*?)|\{([\s\S]*?)\}|([#\/^>&]|else\b)?\s*([\s\S]*?))(~)?\}\}/g,
          root = {
          body: [], inverse: null
      }, stack = [root];
        let last = 0, m, trim = false;
        const cur = () => {
          const t = stack[stack.length - 1];
          return t.inverse || t.body;
      };
        while ((m = re.exec(text)) !== null) {
          let raw = text.slice(last, m.index);
          if (trim) raw = raw.replace(/^\s+/, '');
          if (m[1]) raw = raw.replace(/\s+$/, '');
          if (raw) cur().push({ t: 'text', v: raw });
          trim = !!m[7];
          last = re.lastIndex;
          if (m[2] !== undefined || m[3] !== undefined) continue;
          if (m[4] !== undefined) {
            cur().push({ t: 'raw', ...this.expr(m[4]) });
            continue;
          }
          const [kind, body] = [m[5], m[6].trim()];
          switch (kind) {
            case '#': {
              const as = /^(.*?)\s+as\s+\|([^|]+)\|$/.exec(body), n = {
                t: 'block', body: [], inverse: null, ...this.expr(as ? as[1] : body),
                  as: as ? as[2].trim().split(/\s+/) : null
            };
              cur().push(n);
              stack.push(n);
              break;
            }
            case '^': if (body) {
              const n = {
                t: 'block', body: [], inverse: [], ...this.expr('unless ' + body), as: null
            };
              n.name = body;
              n.inverted = true;
              cur().push(n);
              stack.push(n);
              break;
            }
            case 'else': {
              const top = stack[stack.length - 1];
              if (top === root) throw new SyntaxError('else outside a block');
              if (body && kind === 'else') {
                top.inverse = [];
                const n = {
                  t: 'block', body: [], inverse: null, chained: true, ...this.expr(body),
                    as: null
              };
                top.inverse.push(n);
                stack.push(n);
            } else top.inverse = [];
              break;
            }
            case '/': {
              let top = stack.pop();
              while (top && top.chained) top = stack.pop();
              if (!top || top === root ||
                top.name !== body) throw new SyntaxError('{{/' + body + '}} does not close ' + (top &&
                top.name));
              break;
            }
            case '>': cur().push({ t: 'partial', ...this.expr(body) });
            break;
            case '&': cur().push({ t: 'raw', ...this.expr(body) });
            break;
            default: cur().push({ t: 'value', ...this.expr(body) });
          }
        }
        let raw = text.slice(last);
        if (trim) raw = raw.replace(/^\s+/, '');
        if (raw) cur().push({ t: 'text', v: raw });
        if (stack.length > 1) throw new SyntaxError('open block ' + stack[1].name);
        return root.body;
      }
      expr(s) {
        const parts = s.match(/\w+=(?:"[^"]*"|'[^']*'|\S+)|"[^"]*"|'[^']*'|\([^()]*\)|[^\s()]+/g) ||
          [''], hash = {
      }, args = [];
        for (let i = 1; i < parts.length; i++) {
          const h = /^(\w+)=([\s\S]+)$/.exec(parts[i]);
          if (h) hash[h[1]] = this.arg(h[2]);
          else args.push(this.arg(parts[i]));
        }
        return {
          name: parts[0], args, hash
      };
      }
      arg(s) {
        let m;
        if ((m = /^"([^"]*)"$|^'([^']*)'$/.exec(s))) return {
          k: 'lit', v: m[1] ?? m[2]
      };
        if (/^-?\d+(\.\d+)?$/.test(s)) return {
          k: 'lit', v: +s
      };
        if (s === 'true' || s === 'false') return {
          k: 'lit', v: s === 'true'
      };
        if (s === 'null' || s === 'undefined') return {
          k: 'lit', v: s === 'null' ? null : undefined
      };
        if (s[0] === '(') return {
          k: 'sub', ...this.expr(s.slice(1, -1))
      };
        return {
          k: 'path', v: s
      };
      }
      lookup(path, c) {
        if (path === 'this' || path === '.') return c.self;
        if (path[0] === '@') return path.slice(1) === 'root' ? c.root : c.data[path.slice(1)];
        while (path.startsWith('../')) {
          path = path.slice(3);
          c = c.parent || c;
        }
        const parts = path.replace(/\[([^\]]*)\]/g, '$1').split(/[.\/]/);
        if (parts[0] === 'this') {
          parts.shift();
      } else if (own(c.vars, parts[0])) {
          let v = c.vars[parts.shift()];
          for (const p of parts) v = v == null ? undefined : v[p];
          return v;
        }
        let v = c.self;
        for (const p of parts) {
          if (v == null) return undefined;
          v = own(Object(v), p) ? v[p] : undefined;
        }
        return v;
      }
      value(a, c) {
        switch (a.k) {
          case 'lit': return a.v;
          case 'sub': return this.call(a, c, {});
          default: return this.lookup(a.v, c);
        }
      }
      call(n, c, extra) {
        const h = this.helpers[n.name];
        if (h) {
          const hash = {
        };
          for (const k in n.hash) hash[k] = this.value(n.hash[k], c);
          return h.apply(c.self, n.args.map(a => this.value(a, c)).concat({ hash, name: n.name,
            data: c.data, ...extra }));
        }
        if (n.args.length) throw new ReferenceError('Missing helper: ' + n.name);
        const v = this.value(this.arg(n.name), c);
        return typeof v === 'function' ? v.call(c.self, { hash: {}, ...extra }) : v;
      }
      run(nodes, c) {
        let out = '';
        for (const n of nodes) switch (n.t) {
          case 'text': out += n.v;
          break;
          case 'raw': {
            const v = this.call(n, c, {});
            out += v == null ? '' : v;
            break;
          }
          case 'value': {
            const v = this.call(n, c, {});
            out += v == null || v === false ? '' : v &&
              v.html !== undefined ? v.html : String(v).replace(/[&<>"'`=]/g,
              x => '&#x' + x.charCodeAt(0).toString(16).toUpperCase() + ';');
            break;
          }
          case 'partial': {
            const t = this.partials[n.name];
            if (t === undefined) throw new ReferenceError('no partial ' + n.name);
            if ((c.depth || 0) > 20) throw new RangeError('partials too deep');
            let ast = this.cache.get(n.name);
            if (!ast) {
              this.compiled++;
              this.cache.set(n.name, ast = this.parse(t));
            }
            let self = n.args.length ? this.value(n.args[0], c) : c.self;
            const hash = {
          };
            for (const k in n.hash) hash[k] = this.value(n.hash[k], c);
            if (Object.keys(n.hash).length) self = Object.assign({}, self, hash);
            out += this.run(ast, { self, parent: c, root: c.root, data: c.data, vars: c.vars,
              depth: (c.depth || 0) + 1 });
            break;
          }
          case 'block': {
            const make = (body, data, as) => (self, d, bound) => {
              const vars = Object.assign({}, c.vars);
              if (as && bound) as.forEach((name, i) => {
                vars[name] = bound[i];
            });
              return body ? this.run(body, { self, parent: self === c.self ? c.parent : c,
                root: c.root, data: d ? Object.assign({}, data, d) : data, vars,
                depth: c.depth }) : '';
          };
            const fn = make(n.body, c.data, n.as), inverse = make(n.inverse, c.data);
            if (n.inverted) {
              const v = this.lookup(n.name, c);
              if (!v || Array.isArray(v) && !v.length) out += fn(c.self);
              break;
            }
            if (this.helpers[n.name]) {
              out += this.call(n, c, { fn, inverse, as: n.as });
              break;
            }
            const v = this.call(n, c, { fn, inverse });
            if (Array.isArray(v)) {
              if (v.length) v.forEach((x, i) => {
                out += fn(x, { index: i });
            });
              else out += inverse(c.self);
          } else if (v === true) out += fn(c.self);
            else if (v) out += fn(v);
            else out += inverse(c.self);
          }
        }
        return out;
      }
      render(text, self) {
        const ast = this.parse(text);
        this.compiled++;
        return this.run(ast, { self, root: self, data: {}, vars: {} });
      }
    }
    module.exports = Engine;
}).call(exports);
  return module.exports;
})();
const routeTables = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // tables of written expressions in several forms: rows, objects, arrays in fields, switches of kinds; the match is read where it was made, by loops and by names, kept for later turns and compared
    'use strict';
    const TABLE = [   [/^\/item\/(\d+)$/, 'item',
      ['id']],   [/^\/item\/(\d+)\/(edit|copy)(?:\/(\w+))?$/, 'change', ['id', 'how',
      'field']],   [/^\/tag\/([^/]+)(?:\/([^/]+))*$/, 'tag', ['first',
      'last']],   [/^\/(?:(en|de|fr)\/)?about(?:\.(html|txt))?$/, 'about', ['lang',
      'ext']],   [/^\/x(?:-(\w))?(?:-(\w))?(?:-(\w))?(?:-(\w))?$/, 'x', ['a', 'b', 'c',
      'd']],   [/^\/(.*)$/, 'rest', ['all']] ];
    class Table {
      constructor(rows = TABLE) {
        this.rows = rows;
        this.hits = new Array(rows.length).fill(0);
        this.kept = [];
        this.previous = null;
      }
      find(url) {
        const path = url.split('#')[0].slice(0);
        for (let r = 0; r < this.rows.length; r++) {
          const [re, name, keys] = this.rows[r];
          const m = re.exec(path);
          if (m === null) continue;
          this.hits[r]++;
          const params = {
        };
          let filled = 0;
          for (let i = m.length - 1; i >= 1; i--) {
            const v = m[i];
            if (v === undefined) {
              if (keys[i - 1] === 'ext') params.ext = 'html';
              continue;
            }
            params[keys[i - 1]] = /^\d+$/.test(v) ? +v : v;
            filled += v.length;
          }
          const same = this.previous !== null && this.previous.length === m.length &&
            this.previous[1] === m[1];
          this.previous = m;
          if (this.kept.length < 5 || r === 4) this.kept.push(m);
          return {
            name, params, filled, same, whole: m[0].length, at: m.index, input: m.input.length
        };
        }
        return null;
      }
      first(list) {
        for (const u of list) for (const row of this.rows) {
          const m = u.match(row[0]);
          if (m && m[1]) {
            let s = '';
            for (const g of m) s += (g === undefined ? '_' : g[0]);
            return s;
          }
        }
        return '';
      }
      groups() {
        return this.kept.map(m => {
          let n = 0;
          for (let i = 0; i < m.length; i++) if (m[i] !== undefined) n += m[i].length * (i + 1);
          return n;
      });
      }
    }
    function tokens(text) {
      const out = [];
      const kinds = {
        num: /^\d+(\.\d+)?/, word: /^[a-z_]+(\d)?/i, str: /^"((?:[^"\\]|\\(.))*)"/,
          gap: /^\s+/, op: /^(=>|[-+*\/=<>!&|]=?)|^([()[\]{},;.])/
    };
      let rest = text;
      loop: while (rest.length) {
        for (const k in kinds) {
          const m = kinds[k].exec(rest);
          if (!m) continue;
          rest = rest.slice(m[0].length);
          if (k === 'gap') continue loop;
          const extra = [];
          for (let i = 1; i < m.length; i++) extra.push(m[i] ?? null);
          out.push({ k, text: m[0], extra });
          continue loop;
        }
        out.push({ k: 'bad', text: rest[0], extra: [] });
        rest = rest.substring(1);
      }
      return out;
    }
    function fields(line, shape) {
      let m, out = [];
      switch (shape) {
        case 'pair': m = /^(\w+)\s*[:=]\s*(.*)$/.exec(line);
        break;
        case 'list': m = /^[-*] (?:\[(x| )\] )?(.*)$/.exec(line);
        break;
        case 'head': m = /^(#+) (.*?)(?: \{(\w+)\})?$/.exec(line);
        break;
        default: m = line.match(/(\S+)(?: (\S+))?(?: (\S+))?/);
      }
      if (m) for (let i = 1, n = m.length; i < n; i++) out.push(m[i]);
      return out;
    }
    module.exports = {
      Table, tokens, fields, TABLE
  };
}).call(exports);
  return module.exports;
})();
module.exports = { output, say, fractionKit, textTables, sortedTree, writtenRoutes, handleBars, routeTables };
