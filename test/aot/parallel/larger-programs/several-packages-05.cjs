// Several packages in one program: heap-queue, pattern-table, layer-router, date-format, unit-parser, diff-patch
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
const heapQueue = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // a binary heap with updates by key
    class Heap {
      constructor(less) {
        this.items = [];
        this.at = new Map();
        this.less = less || ((a, b) => a.priority < b.priority);
        this.moves = 0;
      }
      get size() {
        return this.items.length;
      }
      push(key, priority, value) {
        if (this.at.has(key)) {
          const i = this.at.get(key), old = this.items[i];
          this.items[i] = {
            key, priority, value
        };
          if (this.less(this.items[i], old)) this._up(i);
          else this._down(i);
          return false;
        }
        this.items.push({ key, priority, value });
        this.at.set(key, this.items.length - 1);
        this._up(this.items.length - 1);
        return true;
      }
      pop() {
        if (!this.items.length) return undefined;
        const top = this.items[0], last = this.items.pop();
        this.at.delete(top.key);
        if (this.items.length) {
          this.items[0] = last;
          this.at.set(last.key, 0);
          this._down(0);
        }
        return top;
      }
      remove(key) {
        const i = this.at.get(key);
        if (i === undefined) return false;
        const last = this.items.pop();
        this.at.delete(key);
        if (i < this.items.length) {
          this.items[i] = last;
          this.at.set(last.key, i);
          this._up(i);
          this._down(this.at.get(last.key));
        }
        return true;
      }
      _swap(i, j) {
        const a = this.items[i], b = this.items[j];
        this.items[i] = b;
        this.items[j] = a;
        this.at.set(b.key, i);
        this.at.set(a.key, j);
        this.moves++;
      }
      _up(i) {
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (!this.less(this.items[i], this.items[p])) break;
          this._swap(i, p);
          i = p;
        }
      }
      _down(i) {
        const n = this.items.length;
        for (;;) {
          let m = i, l = 2 * i + 1, r = l + 1;
          if (l < n && this.less(this.items[l], this.items[m])) m = l;
          if (r < n && this.less(this.items[r], this.items[m])) m = r;
          if (m === i) return;
          this._swap(i, m);
          i = m;
        }
      }
      check() {
        for (let i = 1; i < this.items.length; i++) if (this.less(this.items[i],
          this.items[(i - 1) >> 1])) return false;
        return [...this.at].every(([k, i]) => this.items[i].key === k);
      }
    }
    module.exports = Heap;
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
const layerRouter = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // routes as layers over a compiled expression; exec's groups become parameters
    'use strict';
    function compile(path, keys, options) {
      var sensitive = options && options.sensitive, end = !options || options.end !== false;
      var source = path.replace(/\/\*$/, '/(.*)').replace(/\/:(\w+)(\([^)]*\))?(\?)?/g,
        function (_, name, pattern, optional) {
        keys.push({ name: name, optional: !!optional });
        return (optional ? '(?:/' : '/') + (pattern || '([^/]+?)') + (optional ? ')?' : '');
    });
      if (/\(\.\*\)$/.test(source)) keys.push({ name: String(keys.length), optional: false });
      return new RegExp('^' + source + (end ? '\\/?$' : '(?=\\/|$)'), sensitive ? '' : 'i');
    }
    function decode(val) {
      if (typeof val !== 'string' || val.length === 0) return val;
      try {
        return decodeURIComponent(val);
    } catch (err) {
        err.message = 'Failed to decode param \'' + val + '\'';
        err.status = 400;
        throw err;
      }
    }
    function Layer(path, options, fn) {
      if (!(this instanceof Layer)) return new Layer(path, options, fn);
      this.handle = fn;
      this.name = fn.name || '<anonymous>';
      this.params = undefined;
      this.path = undefined;
      this.keys = [];
      this.regexp = compile(path, this.keys, options);
      this.fastSlash = path === '/' && options.end === false;
    }
    Layer.prototype.match = function match(path) {
      var found;
      if (path != null) {
        if (this.fastSlash) {
          this.params = {
        };
          this.path = '';
          return true;
        }
        found = this.regexp.exec(path);
      }
      if (!found) {
        this.params = undefined;
        this.path = undefined;
        return false;
      }
      this.params = {
    };
      this.path = found[0];
      var keys = this.keys, params = this.params;
      for (var i = 1; i < found.length; i++) {
        var key = keys[i - 1], prop = key.name, val = decode(found[i]);
        if (val !== undefined || !Object.prototype.hasOwnProperty.call(params,
          prop)) params[prop] = val;
      }
      return true;
  };
    function Router() {
      this.stack = [];
      this.calls = 0;
    }
    Router.prototype.use = function (path, fn) {
      if (typeof path === 'function') {
        fn = path;
        path = '/';
      }
      this.stack.push(new Layer(path, { end: false }, fn));
      return this;
  };
    ['get', 'post', 'put', 'delete', 'all'].forEach(function (method) {
      Router.prototype[method] = function (path) {
        for (var i = 1; i < arguments.length; i++) {
          var layer = new Layer(path, { end: true }, arguments[i]);
          layer.method = method;
          this.stack.push(layer);
        }
        return this;
    };
  });
    Router.prototype.handle = function (req, res, done) {
      var idx = 0, stack = this.stack, self = this;
      self.calls++;
      next();
      function next(err) {
        if (err === 'router') return done(null);
        if (idx >= stack.length) return done(err);
        var layer, match = false;
        while (!match && idx < stack.length) {
          layer = stack[idx++];
          try {
            match = layer.match(req.url.split('?')[0]);
        } catch (e) {
            return done(e);
          }
          if (match && layer.method && layer.method !== 'all' &&
            layer.method !== req.method.toLowerCase()) match = false;
        }
        if (!match) return done(err);
        req.params = merge(layer.params, req.params);
        req.matched = layer.path;
        if (err) {
          if (layer.handle.length !== 4) return next(err);
          return layer.handle(err, req, res, next);
        }
        if (layer.handle.length > 3) return next();
        try {
          layer.handle(req, res, next);
      } catch (e) {
          next(e);
        }
      }
  };
    function merge(params, parent) {
      var out = {
    }, k;
      for (k in parent) out[k] = parent[k];
      for (k in params) if (params[k] !== undefined || !(k in out)) out[k] = params[k];
      return out;
    }
    module.exports = {
      Router: Router, Layer: Layer, compile: compile
  };
}).call(exports);
  return module.exports;
})();
const dateFormat = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // formats and parses dates by tokens; everything in UTC
    'use strict';
    var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
      'September', 'October', 'November', 'December'];
    var token = /\[([^\]]+)]|YYYY|YY|M{1,4}|Do|D{1,2}|d{3,4}|H{1,2}|h{1,2}|m{1,2}|s{1,2}|SSS|A|a|X|Q|W/g;
    function pad(v, n) {
      v = String(v);
      while (v.length < (n || 2)) v = '0' + v;
      return v;
    }
    function ordinal(n) {
      var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    function week(d) {
      var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
      return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
    }
    var flags = {
      YYYY: function (d) {
        return pad(d.getUTCFullYear(), 4);
    }, YY: function (d) {
        return String(d.getUTCFullYear()).slice(-2);
    },
      M: function (d) {
        return d.getUTCMonth() + 1;
    }, MM: function (d) {
        return pad(d.getUTCMonth() + 1);
    }, MMM: function (d) {
        return MONTHS[d.getUTCMonth()].slice(0, 3);
    }, MMMM: function (d) {
        return MONTHS[d.getUTCMonth()];
    },
      D: function (d) {
        return d.getUTCDate();
    }, DD: function (d) {
        return pad(d.getUTCDate());
    }, Do: function (d) {
        return ordinal(d.getUTCDate());
    },
      ddd: function (d) {
        return DAYS[d.getUTCDay()].slice(0, 3);
    }, dddd: function (d) {
        return DAYS[d.getUTCDay()];
    },
      H: function (d) {
        return d.getUTCHours();
    }, HH: function (d) {
        return pad(d.getUTCHours());
    }, h: function (d) {
        return d.getUTCHours() % 12 || 12;
    }, hh: function (d) {
        return pad(d.getUTCHours() % 12 || 12);
    },
      m: function (d) {
        return d.getUTCMinutes();
    }, mm: function (d) {
        return pad(d.getUTCMinutes());
    }, s: function (d) {
        return d.getUTCSeconds();
    }, ss: function (d) {
        return pad(d.getUTCSeconds());
    }, SSS: function (d) {
        return pad(d.getUTCMilliseconds(), 3);
    },
      A: function (d) {
        return d.getUTCHours() < 12 ? 'AM' : 'PM';
    }, a: function (d) {
        return d.getUTCHours() < 12 ? 'am' : 'pm';
    }, X: function (d) {
        return Math.floor(d / 1000);
    }, Q: function (d) {
        return (d.getUTCMonth() / 3 | 0) + 1;
    }, W: week
  };
    function format(date, mask) {
      var d = new Date(date);
      if (isNaN(d)) throw new TypeError('Invalid date');
      return mask.replace(token, function (m, lit) {
        return lit !== undefined ? lit : m in flags ? flags[m](d) : m;
    });
    }
    var parsers = {
      YYYY: ['(\\d{4})', function (o, v) {
        o.y = +v;
    }], MM: ['(\\d\\d)', function (o, v) {
        o.m = v - 1;
    }],
      MMM: ['([A-Za-z]{3})', function (o, v) {
        o.m = MONTHS.findIndex(function (x) {
          return x.slice(0, 3).toLowerCase() === v.toLowerCase();
      });
    }],
      DD: ['(\\d\\d)', function (o, v) {
        o.d = +v;
    }], D: ['(\\d\\d?)', function (o, v) {
        o.d = +v;
    }], HH: ['(\\d\\d)', function (o, v) {
        o.h = +v;
    }], mm: ['(\\d\\d)', function (o, v) {
        o.i = +v;
    }], ss: ['(\\d\\d)', function (o, v) {
        o.s = +v;
    }], A: ['(AM|PM)', function (o, v) {
        o.pm = v === 'PM';
    }]
  };
    function parse(text, mask) {
      var acts = [], src = mask.replace(token, function (m) {
        if (!parsers[m]) throw new Error('no parser for ' + m);
        acts.push(parsers[m][1]);
        return parsers[m][0];
    }), m = new RegExp('^' + src + '$', 'i').exec(text);
      if (!m) return null;
      var o = {
        y: 1970, m: 0, d: 1, h: 0, i: 0, s: 0
    };
      for (var k = 1; k < m.length; k++) acts[k - 1](o, m[k]);
      if (o.pm !== undefined) o.h = o.h % 12 + (o.pm ? 12 : 0);
      var t = new Date(Date.UTC(o.y, o.m, o.d, o.h, o.i, o.s));
      return t.getUTCMonth() === o.m && t.getUTCDate() === o.d ? t : null;
    }
    function add(date, n, unit) {
      var d = new Date(date);
      if (unit === 'month' || unit === 'year') {
        var day = d.getUTCDate();
        d.setUTCDate(1);
        if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n);
        else d.setUTCFullYear(d.getUTCFullYear() + n);
        d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1,
          0)).getUTCDate()));
        return d;
      }
      return new Date(+d + n * { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5,
        week: 6048e5 }[unit]);
    }
    function relative(a, b) {
      var s = Math.round((b - a) / 1000), units = [['year', 31536000], ['month', 2592000],
        ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
      for (var i = 0; i < units.length; i++) {
        var n = Math.trunc(s / units[i][1]);
        if (n) return (n > 0 ? 'in ' : '') + Math.abs(n) + ' ' + units[i][0] + (Math.abs(n) > 1 ? 's' : '') + (n < 0 ? ' ago' : '');
      }
      return 'now';
    }
    module.exports = {
      format: format, parse: parse, add: add, relative: relative
  };
}).call(exports);
  return module.exports;
})();
const unitParser = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // amounts with units read by one table after the other: durations, sizes, angles, money, coordinates, times of day
    var UNITS = [   { kind: 'time',
      re: /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i,
      by: { ms: 1, s: 1000, m: 6e4, h: 36e5, d: 864e5, w: 6048e5,
      y: 315576e5 } },   { kind: 'size', re: /^((-|\+)?(\d+(?:\.\d+)?)) *(kb|mb|gb|tb|b)$/i,
      by: { b: 1, kb: 1024, mb: 1048576, gb: 1073741824,
      tb: 1099511627776 } },   { kind: 'angle',
      re: /^(-?[\d.]+)(deg|rad|turn|°)(?: ?(\d+)['′])?(?: ?([\d.]+)["″])?$/ },   { kind: 'money',
      re: /^([$€£])\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d\d))?$|^(\d+)(?:\.(\d\d))? (USD|EUR|GBP)$/ },   { kind: 'clock',
      re: /^(\d\d?):(\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?(?: ?([ap])m?)?$/i } ];
    function unit(u) {
      u = (u || 'ms').toLowerCase();
      if (/^(ms|msec|milli)/.test(u)) return 'ms';
      if (/^mi?n?/.test(u) && u !== 'mb') return 'm';
      return u.charAt(0) === 'h' ? 'h' : u.charAt(0);
    }
    function parse(text) {
      var t = String(text), m, i, part;
      for (var u = 0; u < UNITS.length; u++) {
        m = UNITS[u].re.exec(t);
        if (!m) continue;
        switch (UNITS[u].kind) {
          case 'time': return {
            kind: 'time', value: parseFloat(m[1]) * UNITS[u].by[unit(m[2])], unit: unit(m[2])
        };
          case 'size': return {
            kind: 'size', value: Math.floor(UNITS[u].by[m[4].toLowerCase()] * m[1]), sign: m[2]
        };
          case 'angle': var v = +m[1], k = 60;
          for (i = 3; i < m.length; i++,
            k *= 60) if ((part = m[i]) !== undefined) v += part / k;
          return {
            kind: 'angle',
              value: m[2] === 'rad' ? v * 180 / Math.PI : m[2] === 'turn' ? v * 360 : v,
              parts: m.length
        };
          case 'money': var found = [];
          for (i = 1; i < m.length; i++) if (m[i] !== undefined) found.push(m[i].replace(/,/g,
            ''));
          return {
            kind: 'money', value: found.filter(function (f) {
              return /^\d+$/.test(f);
          }).reduce(function (s, f, n) {
              return s + (n ? f / 100 : +f);
          }, 0), mark: m[1] || m[6], n: found.length
        };
          case 'clock': var sum = 0, scale = 36e5;
          for (i = 1; i <= 3; i++, scale /= 60) sum += (m[i] || 0) * scale;
          if (m[4]) sum += +(m[4] + '00').slice(0, 3);
          if (m[5]) {
            var h = +m[1];
            if (h > 12 || h === 0) return {
              kind: 'clock', value: NaN
          };
            sum += (m[5].toLowerCase() === 'p' ? h === 12 ? 0 : 12 : h === 12 ? -12 : 0) * 36e5;
          }
          return {
            kind: 'clock', value: sum
        };
        }
      }
      return {
        kind: 'none', value: t.length
    };
    }
    function print(o, long) {
      switch (o.kind) {
        case 'time': var a = Math.abs(o.value), list = [['d', 864e5, 'day'], ['h', 36e5,
          'hour'], ['m', 6e4, 'minute'], ['s', 1000, 'second']];
        for (var i = 0; i < list.length; i++) if (a >= list[i][1]) {
          var n = Math.round(o.value / list[i][1]);
          return long ? n + ' ' + list[i][2] + (a >= list[i][1] * 1.5 ? 's' : '') : n + list[i][0];
        }
        return o.value + (long ? ' ms' : 'ms');
        case 'size': var mag = Math.abs(o.value), us = ['B', 'KB', 'MB', 'GB', 'TB'], k = 0;
        while (mag >= 1024 && k < 4) {
          mag /= 1024;
          k++;
        }
        return (o.value < 0 ? '-' : '') + mag.toFixed(2).replace(/(?:\.0*|(\.[^0]+)0+)$/,
          '$1') + us[k];
        case 'angle': var d = Math.floor(o.value), min = (o.value - d) * 60;
        return d + '°' + Math.floor(min) + "'" + ((min % 1) * 60).toFixed(1) + '"';
        case 'money': return o.value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        case 'clock': return isNaN(o.value) ? 'bad' : [36e5, 6e4, 1000].map(function (s, i) {
          return ('0' + Math.floor(o.value / s) % (i ? 60 : 24)).slice(-2);
      }).join(':');
        default: return '?' + o.value;
      }
    }
    module.exports = {
      parse: parse, print: print, units: UNITS
  };
}).call(exports);
  return module.exports;
})();
const diffPatch = (function () {
  const module = {
    exports: {
    }
}, exports = module.exports;
  (function () {
    // patches of text in unified form read by expressions, applied, reversed, merged; conflicts marked
    'use strict';
    const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?$/,
      FILE = /^(---|\+\+\+) (?:[ab]\/)?([^\t\n]+)(?:\t(.*))?$/, BODY = /^([ +\-\\])(.*)$/;
    function parse(text) {
      const files = [];
      let file = null, hunk = null, left = 0, right = 0;
      text.split('\n').forEach((line, n) => {
        let m;
        if (hunk && (left > 0 || right > 0) && (m = BODY.exec(line))) {
          const [, k, t] = m;
          if (k === '\\') return;
          hunk.lines.push({ k, t });
          if (k !== '+') left--;
          if (k !== '-') right--;
          return;
        }
        if ((m = HUNK.exec(line))) {
          if (!file) throw new SyntaxError('hunk without a file at ' + (n + 1));
          const v = [];
          for (let i = 1; i < 5; i++) v.push(m[i] === undefined ? 1 : +m[i]);
          hunk = {
            from: v[0], take: v[1], to: v[2], put: v[3], note: m[5], lines: []
        };
          left = v[1];
          right = v[3];
          file.hunks.push(hunk);
          return;
        }
        if ((m = FILE.exec(line))) {
          if (m[1] === '---') files.push(file = { old: m[2], now: null, stamp: m[3],
            hunks: [] });
          else if (file) file.now = m[2];
          hunk = null;
          return;
        }
        if (line.trim() && hunk) throw new SyntaxError('stray line ' + (n + 1) + ': ' + line);
    });
      return files;
    }
    function apply(text, hunks, fuzz = 2) {
      const lines = text.split('\n'), rejects = [];
      let shift = 0;
      for (const h of hunks) {
        const want = h.lines.filter(l => l.k !== '+').map(l => l.t),
          put = h.lines.filter(l => l.k !== '-').map(l => l.t),
          at = h.from - 1 + shift + (h.take === 0 ? 1 : 0);
        let found = -1;
        search: for (let d = 0; d <= fuzz * 3; d++) for (const s of d ? [-d, d] : [0]) {
          const p = at + s;
          if (p < 0 || p + want.length > lines.length) continue;
          let ok = true;
          for (let i = 0; i < want.length && ok; i++) ok = lines[p + i] === want[i];
          if (ok) {
            found = p;
            break search;
          }
        }
        if (found < 0) {
          rejects.push(h.from);
          continue;
        }
        lines.splice(found, want.length, ...put);
        shift += put.length - want.length + (found - at);
      }
      return {
        text: lines.join('\n'), rejects
    };
    }
    const reverse = hunks => hunks.map(h => ({ ...h, from: h.to, take: h.put, to: h.from,
      put: h.take, lines: h.lines.map(l => ({ ...l,
      k: l.k === '+' ? '-' : l.k === '-' ? '+' : ' ' })) }));
    function diff(a, b, context = 1) {
      a = a.split('\n');
      b = b.split('\n');
      const n = a.length, m = b.length, max = n + m, v = {
        1: 0
    }, trace = [];
      outer: for (let d = 0; d <= max; d++) {
        trace.push({ ...v });
        for (let k = -d; k <= d; k += 2) {
          let x = k === -d || k !== d && v[k - 1] < v[k + 1] ? v[k + 1] : v[k - 1] + 1,
            y = x - k;
          while (x < n && y < m && a[x] === b[y]) {
            x++;
            y++;
          }
          v[k] = x;
          if (x >= n && y >= m) break outer;
        }
      }
      const ops = [];
      let x = n, y = m;
      for (let d = trace.length - 1; d >= 0; d--) {
        const t = trace[d], k = x - y, pk = k === -d || k !== d &&
          t[k - 1] < t[k + 1] ? k + 1 : k - 1, px = t[pk], py = px - pk;
        while (x > px && y > py && x > 0 && y > 0) {
          ops.push([' ', a[--x]]);
          y--;
        }
        if (d > 0) {
          if (x === px) ops.push(['+', b[--y]]);
          else ops.push(['-', a[--x]]);
        }
      }
      ops.reverse();
      const hunks = [];
      let i = 0, la = 1, lb = 1;
      while (i < ops.length) {
        if (ops[i][0] === ' ') {
          i++;
          la++;
          lb++;
          continue;
        }
        let s = i, ctx = 0;
        while (s > 0 && ops[s - 1][0] === ' ' && ctx < context) {
          s--;
          ctx++;
        }
        let e = i, quiet = 0;
        while (e < ops.length && quiet <= context * 2) {
          quiet = ops[e][0] === ' ' ? quiet + 1 : 0;
          e++;
        }
        e -= Math.max(0, quiet - context);
        const lines = ops.slice(s, e).map(([k, t]) => ({ k, t })),
          take = lines.filter(l => l.k !== '+').length,
          put = lines.filter(l => l.k !== '-').length;
        hunks.push({ from: la - ctx, take, to: lb - ctx, put, lines });
        for (; i < e; i++) {
          if (ops[i][0] !== '+') la++;
          if (ops[i][0] !== '-') lb++;
        }
      }
      return hunks;
    }
    const print = (name,
      hunks) => '--- a/' + name + '\n+++ b/' + name + '\n' + hunks.map(h => '@@ -' + h.from + (h.take === 1 ? '' : ',' + h.take) + ' +' + h.to + (h.put === 1 ? '' : ',' + h.put) + ' @@\n' + h.lines.map(l => l.k + l.t).join('\n')).join('\n') + '\n';
    function merge3(base, mine, theirs) {
      const b = base.split('\n'), edits = o => {
        const out = [];
        for (const h of diff(base, o, 0)) out.push({ at: h.take ? h.from - 1 : h.from - 1,
          n: h.take, put: h.lines.filter(l => l.k === '+').map(l => l.t) });
        return out;
    }, A = edits(mine), B = edits(theirs), out = [];
      let i = 0, x = 0, y = 0, conflicts = 0;
      while (i <= b.length) {
        const p = A[x] && A[x].at === i ? A[x] : null, q = B[y] && B[y].at === i ? B[y] : null;
        if (p && q) {
          if (p.put.join('\n') === q.put.join('\n') && p.n === q.n) out.push(...p.put);
          else {
            conflicts++;
            out.push('<<<<<<<', ...p.put, '=======', ...q.put, '>>>>>>>');
          }
          i += Math.max(p.n, q.n);
          x++;
          y++;
          if (!p.n && !q.n) {
            if (i < b.length) out.push(b[i]);
            i++;
          }
          continue;
        }
        const e = p || q;
        if (e) {
          out.push(...e.put);
          i += e.n;
          if (p) x++;
          else y++;
          if (!e.n) {
            if (i < b.length) out.push(b[i]);
            i++;
          }
          continue;
        }
        if (i < b.length) out.push(b[i]);
        i++;
      }
      return {
        text: out.join('\n'), conflicts
    };
    }
    module.exports = {
      parse, apply, reverse, diff, print, merge3
  };
}).call(exports);
  return module.exports;
})();
function heapQueueMixedPrioritiesRun(lib) {
  const h = new lib();
  let s = 7;
  const next = () => (s = s * 1103515245 + 12345 & 0x7fffffff) % 100;
  for (let i = 0; i < 60; i++) {
    const k = i % 2 ? 'k' + next() % 20 : next() % 20;
    const p = i < 20 ? next() : i < 40 ? next() / 8 : i % 9 === 0 ? NaN : -next();
    const r = h.push(k, p, { i });
    if (i % 5 === 4) {
      const t = h.pop();
      say(i, r, t.key, t.priority, t.value.i, h.size, h.check());
    }
    if (i % 13 === 12) say('remove', k, h.remove(k), h.remove('none'), h.check());
  }
  const order = [];
  while (h.size) order.push(h.pop().key);
  say(order.join(), h.moves, h.pop());
}
function heapQueueWordsRun(lib) {
  const h = new lib((a, b) => a.priority.length < b.priority.length ||
    a.priority.length === b.priority.length && a.priority < b.priority);
  const words = 'the quick brown fox jumps over the lazy dog and then some more words that are long enough to matter'.split(' ');
  for (let round = 0; round < 9; round++) {
    words.forEach((w, i) => h.push(round ? w + round : w, round === 2 ? w.toUpperCase() : w,
      i * round));
    const out = [];
    for (let i = 0; i < 12; i++) {
      const t = h.pop();
      out.push(t.key + '/' + t.value);
    }
    say(round, out.join(' '), h.size, h.moves, h.check());
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
function layerRouterRequestsRun(lib) {
  var r = new lib.Router();
  r.use(function logger(req, res, next) {
    res.log.push('log ' + req.method);
    next();
});
  r.get('/users/:id', function (req, res) {
    res.end('user ' + req.params.id);
});
  r.get('/users/:id/books/:book?', function (req, res) {
    res.end('books ' + req.params.id + ' ' + req.params.book);
});
  r.post('/files/*', function (req, res) {
    res.end('file ' + JSON.stringify(req.params));
});
  r.get('/n/:year(\\d{4})-:month(\\d\\d)', function (req, res) {
    res.end('never ' + JSON.stringify(req.params));
});
  r.get('/fail/:x', function (req) {
    throw new Error('bad ' + req.params.x);
});
  r.use(function (err, req, res, next) {
    res.end('error ' + err.message);
});
  var urls = [['GET', '/users/1'], ['GET', '/users/2/'], ['GET', '/users/a%20b'], ['GET',
    '/users/7/books'], ['GET', '/users/8/books/ulysses?x=1'], ['POST', '/files/a/b/c.txt'],
    ['GET', '/nope'], ['GET', '/fail/now'], ['GET', '/USERS/Nine'], ['GET', '/users/%zz']];
  for (var round = 0; round < 5; round++) urls.forEach(function (u, i) {
    var res = {
      log: [], end: function (t) {
        this.body = t;
      }
  }, req = {
      method: u[0], url: u[1].replace(/\d+/, function (d) {
        return +d + round * 10 + i;
    })
  };
    r.handle(req, res, function (err) {
      res.end(err ? 'done ' + err.message + ' ' + err.status : 'not found');
  });
    say(round, req.url, res.body, res.log.length, JSON.stringify(req.params));
});
  say(r.calls);
}
function layerRouterManyParamsRun(lib) {
  var keys = [], re = lib.compile('/a/:one/:two?/b/:three', keys);
  say(String(re), keys.length);
  var layer = new lib.Layer('/:a/:b/:c/:d', { end: true }, function named() {
});
  say(layer.name);
  for (var i = 0; i < 40; i++) {
    var path = '/' + [i, 'x' + i % 7, i % 3 ? 'y' : '%C3%A9', i * i].join('/');
    say(path, layer.match(path), JSON.stringify(layer.params), layer.path);
    if (i % 5 === 0) say(layer.match('/short'), layer.params);
  }
  for (var j = 0; j < 12; j++) {
    var m = re.exec(j % 2 ? '/a/1/b/' + j : '/a/q/' + j + '/b/z');
    say(m && m.slice(1).map(String).join('|'));
  }
}
function layerRouterNestedRun(lib) {
  var top = new lib.Router(), api = new lib.Router(), seen = [];
  api.get('/items/:item', function getItem(req, res, next) {
    seen.push(req.params.version + ':' + req.params.item);
    next();
});
  api.get('/items/:item', function second(req, res) {
    res.body = 'second ' + Object.keys(req.params).sort().join();
});
  top.use('/api/:version', function (req, res, next) {
    var old = req.url;
    req.url = req.url.slice(req.matched.length) || '/';
    api.handle(req, res, function (e) {
      req.url = old;
      next(e);
  });
});
  top.all('/:anything', function (req, res) {
    res.body = 'any ' + req.params.anything;
});
  for (var i = 0; i < 24; i++) {
    var res = {
  }, req = {
      method: i % 2 ? 'GET' : 'get',
        url: i % 4 === 3 ? '/plain' + i : '/api/v' + i % 3 + '/items/' + (i * 37 % 11)
  };
    top.handle(req, res, function (e) {
      res.body = 'end ' + e;
  });
    say(i, req.url, res.body);
  }
  say(seen.join(' '));
}
function dateFormatFormatRun(lib) {
  var masks = ['YYYY-MM-DD HH:mm:ss.SSS', 'dddd, MMMM Do YYYY', 'h:m:s a [on] ddd D/M/YY',
    'Q W X', '[YYYY] YYYY', 'hh A MMM DD', 'x'];
  for (var i = 0; i < 30; i++) {
    var d = Date.UTC(2023 + i % 4, i * 5 % 14, i * 11 % 31 + 1, i * 7 % 25, i * 13 % 61, i,
      i * 37);
    say(i, lib.format(d, masks[i % masks.length]), lib.format(lib.add(d, i % 2 ? i : -i,
      ['month', 'year', 'day', 'week', 'hour', 'minute'][i % 6]), 'YYYY-MM-DD HH:mm'),
      lib.relative(d, +lib.add(d, i - 15, ['second', 'minute', 'hour', 'day',
      'month'][i % 5])));
  }
  try {
    lib.format('nonsense', 'YYYY');
} catch (e) {
    say(e.message);
  }
}
function dateFormatParseRun(lib) {
  [['2026-11-12', 'YYYY-MM-DD'], ['2026-02-30', 'YYYY-MM-DD'], ['12 Nov 2026', 'D MMM YYYY'],
    ['1 foo 2026', 'D MMM YYYY'], ['2026-11-12 23:59:58', 'YYYY-MM-DD HH:mm:ss'], ['11:05 PM',
    'HH:mm A'], ['12:05 AM', 'HH:mm A'], ['nope', 'YYYY'], ['2024-02-29', 'YYYY-MM-DD'], ['x',
    'Q']].forEach(function (p) {
    for (var k = 0; k < 3; k++) try {
      var d = lib.parse(k ? p[0].replace('2026', 2020 + k) : p[0], p[1]);
      say(p.join(' by '), k, d && d.toISOString());
  } catch (e) {
      say(e.message);
    }
});
}
function unitParserTextsRun(lib) {
  ['1', '53 yrs', '.5ms', '-100ms', '1.5h', '2 days', '1 Week', '10 minutes', '5M', '1kb',
    '-1.5 GB', '+12 mb', '10TB', '90deg', '1.5turn', '3.14159rad', "12° 30' 15\"", "-0.5°",
    '$1,234.56', '€5', '£ 1,000,000', '12.50 USD', '7 GBP', '12:30', '1:02:03.5', '12:00 am',
    '12:15pm', '13:00 p', '7:05 PM', 'nothing', '', '1,2', '$1,23', '10 b',
    '1 mb extra'].forEach(function (t, i) {
    for (var k = 0; k < 3; k++) {
      var s = k === 1 ? t.replace(/\d/g, function (d) {
        return (+d + i) % 10;
    }) : k === 2 ? (t + '|' + i).split('|')[0] : t, o = lib.parse(s);
      say(i, k, JSON.stringify(s), JSON.stringify(o), lib.print(o), lib.print(o, true));
    }
});
}
function unitParserSumsRun(lib) {
  var totals = {
}, mixed = ['5m', '2kb', '10deg', '$3.50', '1:30', '90s', '1.5 MB', '0.25turn', '4 EUR',
  '11:59:59 pm', 'x', 7, null, 1e3, '1h', '12 b', '-2d'];
  for (var i = 0; i < 60; i++) {
    var o = lib.parse(i % 4 === 3 ? String(mixed[i % 17]).toUpperCase() : mixed[(i * 5) % 17]);
    totals[o.kind] = (totals[o.kind] || 0) + o.value;
    if (i === 25) lib.units.reverse();
    if (i === 40) lib.units.unshift({ kind: 'time', re: /^(\d+) ticks?$/, by: { t: 10 } });
    if (i % 6 === 5) say(i, JSON.stringify(totals), lib.print({ kind: 'time',
      value: totals.time || 0 }, true), lib.print({ kind: 'size', value: totals.size || 0 }),
      JSON.stringify(lib.parse(i + ' ticks')));
  }
}
function diffPatchRoundTripsRun(lib) {
  let text = Array.from({ length: 14 }, (_, i) => 'line ' + i).join('\n');
  let seed = 4;
  const r = n => (seed = seed * 48271 % 2147483647) % n;
  for (let i = 0; i < 16; i++) {
    const l = text.split('\n');
    for (let k = 0; k < 1 + i % 4; k++) {
      const at = r(l.length);
      if (k % 3 === 0) l.splice(at, 1);
      else if (k % 3 === 1) l.splice(at, 0, 'new ' + i + '.' + k);
      else l[at] += '!';
    }
    const next = l.join('\n'), hunks = lib.diff(text, next, i % 3), out = lib.print('f.txt',
      hunks), back = lib.parse(out), a = lib.apply(text, back[0] ? back[0].hunks : []),
      z = lib.apply(a.text, lib.reverse(back[0] ? back[0].hunks : []));
    say(i, hunks.length, a.text === next, z.text === text, a.rejects.join(), z.rejects.join(),
      JSON.stringify(out));
    const moved = lib.apply('top\n' + text, hunks);
    say(moved.rejects.join(), moved.text === 'top\n' + next);
    text = next;
  }
}
function diffPatchMergesRun(lib) {
  const base = 'a\nb\nc\nd\ne';
  const edits = [base, 'a\nB\nc\nd\ne', 'a\nb\nc\nd\ne\nf', 'b\nc\nd\ne', 'a\nb\nX\nY\nd\ne',
    '', 'a\nb\nc\nD\ne', 'z\na\nb\nc\nd\ne'];
  edits.forEach((m, i) => edits.forEach((t, k) => {
    const r = lib.merge3(base, m, t);
    say(i, k, r.conflicts, JSON.stringify(r.text));
}));
  for (const bad of ['@@ -1 +1 @@\n', '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\nstray',
    '--- x\t2026\n+++ y\n@@ -0,0 +1,2 @@ note\n+p\n+q\n\\ No newline']) try {
    say(JSON.stringify(lib.parse(bad)));
} catch (e) {
    say(e.message);
  }
}
for (let round = 0; round < 4; round++) {
  heapQueueMixedPrioritiesRun(heapQueue);
  heapQueueWordsRun(heapQueue);
  patternTableLinesRun(patternTable);
  patternTableOwnRulesRun(patternTable);
  patternTableReplacedRun(patternTable);
  layerRouterRequestsRun(layerRouter);
  layerRouterManyParamsRun(layerRouter);
  layerRouterNestedRun(layerRouter);
  dateFormatFormatRun(dateFormat);
  dateFormatParseRun(dateFormat);
  unitParserTextsRun(unitParser);
  unitParserSumsRun(unitParser);
  diffPatchRoundTripsRun(diffPatch);
  diffPatchMergesRun(diffPatch);
  output.first = false;
  console.log("round", round, output.lines, output.hash);
}
