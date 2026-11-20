// Several packages in one program: counters-widen, handle-bars, pack-codes, wild-bus, trie-router, color-reader
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
const countersWiden = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // records whose fields begin as small integers and become fractions, large, missing, texts or big on later turns
    'use strict';
    class Meter {
      total = 0;
      n = 0;
      last;
      low = 2147483647;
      high = -2147483648;
      flags = 0;
      label = null;
      add(x) {
        this.n++;
        this.last = x;
        this.total += x;
        if (x < this.low) this.low = x;
        if (x > this.high) this.high = x;
        this.flags |= x;
        return this;
      }
      get mean() {
        return this.total / this.n;
      }
      scale(k) {
        this.total *= k;
        this.low *= k;
        this.high = this.high * k;
        return this;
      }
      step() {
        this.n += 1;
        this.total -= 1;
        return this.n++ + ++this.n;
      }
      reset() {
        this.total = this.n = 0;
        this.last = undefined;
        return this;
      }
    }
    class Wide extends Meter {
      extra = -1;
      add(x) {
        super.add(x);
        this.extra = this.extra * 2 + 1;
        return this;
      }
      wrap() {
        return Math.imul(this.total, this.n) | 0;
      }
    }
    function Old(a, b) {
      this.a = a | 0;
      this.b = b;
      this.c = this.a + this.b;
    }
    Old.prototype.next = function () {
      this.a = (this.a + 1) | 0;
      this.b = this.b + this.a;
      this.c = this.a * this.b;
      return this.c;
  };
    Old.prototype.mark = function (k, v) {
      if (this[k] === undefined) this[k] = 0;
      this[k] += v;
      return this[k];
  };
    Old.zero = new Old(0, 0);
    function sum(list, key) {
      var s = 0;
      for (var i = 0; i < list.length; i++) s += list[i][key];
      return s;
    }
    module.exports = {
      Meter: Meter, Wide: Wide, Old: Old, sum: sum
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
const packCodes = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // text packed by prefix codes, by dictionaries and by runs; all three unpacked again
    'use strict';
    class Bits {
      constructor(bytes = []) {
        this.bytes = bytes;
        this.n = 0;
        this.at = 0;
      }
      put(v, w) {
        for (let i = w - 1; i >= 0; i--) {
          if (this.n % 8 === 0) this.bytes.push(0);
          if (v >> i & 1) this.bytes[this.n >> 3] |= 128 >> this.n % 8;
          this.n++;
        }
      }
      get(w = 1) {
        let v = 0;
        while (w--) {
          v = v << 1 | this.bytes[this.at >> 3] >> 7 - this.at % 8 & 1;
          this.at++;
        }
        return v;
      }
    }
    function huffman(text) {
      const freq = new Map();
      for (const c of text) freq.set(c, (freq.get(c) ?? 0) + 1);
      let nodes = [...freq].map(([c, n]) => ({ c, n, low: c })).sort((a, b) => a.n - b.n ||
        (a.low < b.low ? -1 : 1));
      if (!nodes.length) return {
        codes: new Map(), bits: new Bits(), length: 0, tree: null
    };
      while (nodes.length > 1) {
        const [a, b] = nodes.splice(0, 2), n = {
          n: a.n + b.n, a, b, low: a.low < b.low ? a.low : b.low
      };
        let i = 0;
        while (i < nodes.length && (nodes[i].n < n.n || nodes[i].n === n.n &&
          nodes[i].low < n.low)) i++;
        nodes.splice(i, 0, n);
      }
      const codes = new Map();
      (function walk(n, code) {
        if (n.c !== undefined) codes.set(n.c, code || '0');
        else {
          walk(n.a, code + '0');
          walk(n.b, code + '1');
        }
    })(nodes[0], '');
      const bits = new Bits();
      for (const c of text) for (const b of codes.get(c)) bits.put(+b, 1);
      return {
        codes, bits, length: [...text].length, tree: nodes[0]
    };
    }
    function unhuffman(p) {
      let out = '';
      for (let i = 0; i < p.length; i++) {
        let n = p.tree;
        if (n.c !== undefined) {
          p.bits.get();
          out += n.c;
          continue;
      } while (n.c === undefined) n = p.bits.get() ? n.b : n.a;
        out += n.c;
      }
      return out;
    }
    function lzw(text) {
      let dict = {
    }, size = 256, w = '', out = [];
      for (let i = 0; i < 256; i++) dict[String.fromCharCode(i)] = i;
      for (let i = 0; i < text.length; i++) {
        const c = text.charAt(i), wc = w + c;
        if (Object.prototype.hasOwnProperty.call(dict, wc)) w = wc;
        else {
          out.push(dict[w]);
          dict[wc] = size++;
          w = c;
        }
      }
      if (w !== '') out.push(dict[w]);
      return out;
    }
    function unlzw(codes) {
      if (!codes.length) return '';
      let dict = [], w = String.fromCharCode(codes[0]), out = w;
      for (let i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);
      for (let i = 1; i < codes.length; i++) {
        const k = codes[i];
        let entry;
        if (dict[k] !== undefined) entry = dict[k];
        else if (k === dict.length) entry = w + w.charAt(0);
        else throw new RangeError('bad code ' + k + ' at ' + i);
        out += entry;
        dict.push(w + entry.charAt(0));
        w = entry;
      }
      return out;
    }
    function lz77(s, win = 64) {
      const out = [];
      let i = 0;
      while (i < s.length) {
        let best = 0, dist = 0;
        for (let j = Math.max(0, i - win); j < i; j++) {
          let k = 0;
          while (i + k < s.length && s[j + k] === s[i + k] && k < 18) k++;
          if (k >= best && k > 2) {
            best = k;
            dist = i - j;
          }
        }
        if (best) {
          out.push([dist, best]);
          i += best;
      } else out.push(s[i++]);
      }
      return out;
    }
    function unlz77(list) {
      const out = [];
      for (const x of list) {
        if (typeof x === 'string') out.push(x);
        else {
          const [d, n] = x;
          for (let k = 0; k < n; k++) out.push(out[out.length - d]);
        }
      }
      return out.join('');
    }
    const rle = s => s.replace(/([\s\S])\1{2,}/g, (m,
      c) => c + '\x01' + String.fromCharCode(m.length + 32)),
      unrle = s => s.replace(/([\s\S])\x01([\s\S])/g, (m, c,
      n) => c.repeat(n.charCodeAt(0) - 32));
    function bwt(s) {
      const t = s + '\x00', rows = Array.from(t, (_, i) => i).sort((a, b) => {
        for (let k = 0; k < t.length; k++) {
          const x = t.charCodeAt((a + k) % t.length), y = t.charCodeAt((b + k) % t.length);
          if (x !== y) return x - y;
        }
        return 0;
    });
      return rows.map(i => t[(i + t.length - 1) % t.length]).join('');
    }
    function unbwt(s) {
      const n = s.length, count = {
    }, rank = [];
      for (let i = 0; i < n; i++) {
        count[s[i]] = (count[s[i]] || 0) + 1;
        rank[i] = count[s[i]] - 1;
      }
      const first = {
    };
      let sum = 0;
      for (const c of Object.keys(count).sort()) {
        first[c] = sum;
        sum += count[c];
      }
      let out = '', i = 0;
      for (let k = 0; k < n - 1; k++) {
        const c = s[i];
        out = c + out;
        i = first[c] + rank[i];
      }
      return out;
    }
    const mtf = s => {
      const list = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i));
      return [...s].map(c => {
        const i = list.indexOf(c);
        if (i > 0) {
          list.splice(i, 1);
          list.unshift(c);
        }
        return i;
    });
  };
    module.exports = {
      Bits, huffman, unhuffman, lzw, unlzw, lz77, unlz77, rle, unrle, bwt, unbwt, mtf
  };
}).call(exports);
  return module.exports;
})();
const wildBus = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // an event bus with name spaces, wild cards, once, removal while emitting, error events and answers
    'use strict';
    class Listener {
      constructor(fn, ctx, once, order) {
        this.fn = fn;
        this.ctx = ctx;
        this.once = once;
        this.order = order;
        this.calls = 0;
      }
    }
    class Bus {
      constructor(options = {}) {
        this.sep = options.sep || '.';
        this.max = options.max ?? 10;
        this.tree = Object.create(null);
        this.seq = 0;
        this.warned = [];
      }
      node(name, make) {
        let n = this.tree;
        for (const part of Array.isArray(name) ? name : name.split(this.sep)) {
          if (!n[part]) {
            if (!make) return null;
            n[part] = Object.create(null);
          }
          n = n[part];
        }
        return n;
      }
      on(name, fn, ctx, once = false, front = false) {
        if (typeof fn !== 'function') throw new TypeError('listener must be a function, got ' + typeof fn);
        const n = this.node(name, true), list = n[Bus.LIST] || (n[Bus.LIST] = []);
        const l = new Listener(fn, ctx === undefined ? this : ctx, once,
          front ? -++this.seq : ++this.seq);
        list.push(l);
        if (list.length > this.max && !list.warned) {
          list.warned = true;
          this.warned.push(String(name));
        }
        this.emit('newListener', name, fn);
        return this;
      }
      once(name, fn, ctx) {
        return this.on(name, fn, ctx, true);
      }
      prepend(name, fn, ctx) {
        return this.on(name, fn, ctx, false, true);
      }
      off(name, fn) {
        const n = this.node(name);
        if (!n || !n[Bus.LIST]) return this;
        if (fn) {
          const list = n[Bus.LIST];
          for (let i = list.length; i--;) if (list[i].fn === fn) {
            n[Bus.LIST] = list.slice(0, i).concat(list.slice(i + 1));
            break;
          }
          if (!n[Bus.LIST].length) delete n[Bus.LIST];
      } else delete n[Bus.LIST];
        return this;
      }
      match(parts, i, n, out) {
        if (!n) return out;
        if (i === parts.length) {
          if (n[Bus.LIST]) out.push(...n[Bus.LIST]);
          if (n['**'] && n['**'][Bus.LIST]) out.push(...n['**'][Bus.LIST]);
          return out;
        }
        const p = parts[i];
        if (p === '*') {
          for (const k in n) if (k !== '**') this.match(parts, i + 1, n[k], out);
      } else this.match(parts, i + 1, n[p], out);
        this.match(parts, i + 1, n['*'], out);
        if (n['**']) for (let k = i; k <= parts.length; k++) this.match(parts, k, n['**'], out);
        return out;
      }
      emit(name, ...args) {
        const parts = Array.isArray(name) ? name : name.split(this.sep), seen = new Set(),
          found = this.match(parts, 0, this.tree, []).filter(l => !seen.has(l) &&
          seen.add(l)).sort((a, b) => a.order - b.order);
        if (!found.length) {
          if (parts[0] === 'error') throw args[0] instanceof Error ? args[0] : new Error('Unhandled error: ' + args[0]);
          return false;
        }
        this.event = name;
        for (const l of found) {
          if (l.once) this.off(name, l.fn);
          l.calls++;
          const r = l.fn.apply(l.ctx, args);
          if (r === Bus.STOP) break;
        }
        return true;
      }
      ask(name, ...args) {
        const out = [];
        for (const l of this.match(name.split(this.sep), 0, this.tree,
          [])) out.push(l.fn.call(l.ctx, ...args));
        return out;
      }
      count(name) {
        return this.match(name.split(this.sep), 0, this.tree, []).length;
      }
    }
    Bus.LIST = Symbol('listeners');
    Bus.STOP = {
  };
    module.exports = Bus;
}).call(exports);
  return module.exports;
})();
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
const colorReader = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // colors by a table of expressions, each with its own reader of the groups
    'use strict';
    var names = {
      red: 'f00', teal: '008080', navy: '000080', rebecca: '663399'
  };
    var readers = [   { re: /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i,
      read: function (m) {
      var c = [];
      for (var i = 1; i < 5; i++) c.push(m[i] === undefined ? 255 : parseInt(m[i] + m[i], 16));
      c[3] /= 255;
      return c;
    }
  },   { re: /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i, read: function (m) {
      var c = [];
      for (var i = 1; i < m.length; i++) c.push(m[i] === undefined ? 255 : parseInt(m[i], 16));
      c[3] /= 255;
      return c;
    }
  },   { re: /^rgba?\(\s*(\d+%?)\s*[, ]\s*(\d+%?)\s*[, ]\s*(\d+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i,
    read: function (m) {
      var c = [0, 0, 0, 1];
      for (var i = m.length; i-- > 1;) {
        var p = m[i];
        if (p === undefined) continue;
        var n = parseFloat(p);
        c[i - 1] = p[p.length - 1] === '%' ? i === 4 ? n / 100 : n * 2.55 : n;
      }
      return c;
    }
  },   { re: /^hsla?\(\s*(-?[\d.]+)(deg|turn|rad)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%(?:\s*[,/]\s*([\d.]+))?\s*\)$/i,
    read: function (m) {
      var h = +m[1] * (m[2] === 'turn' ? 360 : m[2] === 'rad' ? 180 / Math.PI : 1);
      return hsl(((h % 360) + 360) % 360, m[3] / 100,
        m[4] / 100).concat(m[5] === undefined ? 1 : +m[5]);
    }
  } ];
    function hsl(h, s, l) {
      var a = s * Math.min(l, 1 - l);
      return [0, 8, 4].map(function (n) {
        var k = (n + h / 30) % 12;
        return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    });
    }
    function Color(text) {
      var s = String(text).trim();
      if (Object.prototype.hasOwnProperty.call(names,
        s.toLowerCase())) s = '#' + names[s.toLowerCase()];
      for (var i = 0; i < readers.length; i++) {
        var m = s.match(readers[i].re);
        if (m) {
          this.kind = i;
          this.c = readers[i].read(m);
          this.groups = 0;
          for (var k = 1; k < m.length; k++) if (m[k] !== undefined) this.groups += m[k].length;
          return;
        }
      }
      throw new RangeError('unknown color: ' + text);
    }
    Color.prototype.hex = function () {
      return '#' + this.c.slice(0, 3).map(function (v) {
        v = Math.round(Math.max(0, Math.min(255, v)));
        return (v < 16 ? '0' : '') + v.toString(16);
    }).join('') + (this.c[3] < 1 ? Math.round(this.c[3] * 255).toString(16) : '');
  };
    Color.prototype.mix = function (o, w) {
      var r = Object.create(Color.prototype);
      r.kind = -1;
      r.c = this.c.map(function (v, i) {
        return v * (1 - w) + o.c[i] * w;
    });
      return r;
  };
    Object.defineProperty(Color.prototype, 'luminance', { get: function () {
      return this.c.slice(0, 3).map(function (v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }).reduce(function (s, v, i) {
        return s + v * [0.2126, 0.7152, 0.0722][i];
    }, 0);
    }
  });
    Color.readers = readers;
    module.exports = Color;
}).call(exports);
  return module.exports;
})();
module.exports = { output, say, countersWiden, handleBars, packCodes, wildBus, trieRouter, colorReader };
