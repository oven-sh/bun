// Several packages in one program: c-lexer, log-lines, matrix-nests, written-routes, layered-options, xml-events, in two modules
const { output, say, cLexer, logLines, matrixNests, writtenRoutes, layeredOptions, xmlEvents } = require("./lib.cjs");
function cLexerSourcesRun(lib) {
  var texts = ['var x = 0x1F + 0b101 - .5e3 * 1_000;',
    'if (a >>>= b ?? c?.d) return "q\\n\\u0041\\x42";',
    '/* one\ntwo */ let $y_1 = \'it\\\'s\' // end\nfoo(...z)',
    'const n = 123n ** 2n; é = n => n', 'a+++b---c', '"open', '@', "'a\nb'", 'x /* never', '',
    '\t\r\n  \n', '"\\u00zz"'];
  for (var k = 0; k < 4; k++) texts.forEach(function (t, i) {
    try {
      say(k, i, lib((k ? 'p' + k + ';' : '') + t).map(function (x) {
        return x.type[0] + ':' + String(x.value) + '@' + x.line + ':' + x.column;
    }).join(' '));
  } catch (e) {
      say(k, i, String(e), e.pos);
    }
});
}
function cLexerCountsRun(lib) {
  var total = {
}, src = '';
  for (var i = 0; i < 120; i++) {
    src += ['function f' + i + '(a, b) {', '  return a * ' + i + ' + b / 2.' + i + ';', '}',
      'let s' + i + ' = "t' + i + '";',
      'if (s' + i + ' !== f' + i + '(1, 2)) { x = ' + i + ' << 3; }'][i % 5] + '\n';
    if (i % 10 === 9) {
      var t = lib(src);
      t.forEach(function (x) {
        total[x.type] = (total[x.type] || 0) + 1;
    });
      say(i, t.length, t[t.length - 1].line, t[t.length >> 1].value, JSON.stringify(total));
    }
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
function writtenRoutesRequestsRun(lib) {
  var urls = ['/a/one/two', '/a/one', '/a', '/b/12.json', '/b/3', '/c', '/a/x?q=/b/3',
    '/USER/7/posts', '/user/8/?tab=no', '/user/9/a%20b', '/2026/11/12/some-post',
    '/2026/1/12/x', '/search', '/search/page/3', '/search/desc?x', '/search/page/4/asc',
    '/static/', '/static/a/b.css?v=1'];
  for (var n = 0; n < 3; n++) urls.forEach(function (u, i) {
    var r = lib.route(n ? u.replace(/\d/g, function (d) {
      return (+d + n) % 10;
  }) : u);
    say(n, i, r && JSON.stringify(r));
});
  say(lib.routes.map(function (r) {
    return r.name + r.hits;
}).join());
}
function writtenRoutesAddedLateRun(lib) {
  for (var i = 0; i < 30; i++) {
    if (i === 5) lib.add(/^\/late\/(a)?(b)?(c)?(\w*)$/, ['a', 'b', 'c', 'rest'], 'late',
      'both');
    if (i === 12) lib.routes.unshift(lib.routes.pop());
    if (i === 18) lib.routes[1].how = 'both';
    var u = ['/late/abc', '/late/b' + i, '/late/', '/a/l' + i, '/late/cx?late',
      '/b/' + i + '.json'][i % 6], r = lib.route(u);
    say(i, u, JSON.stringify(r));
  }
}
function writtenRoutesOldLayersRun(lib) {
  var o = new lib.Old([[/^(get|put) (\S+)(?: (\{.*\}))?$/, function (m, p, b, n) {
    return m + '>' + p + '>' + b + n;
}, 'no body'], [/^(\w)(\w)?(\w)?$/, function () {
    return [].join.call(arguments, '/');
}, 0], [/^#(?<tag>\w+)(?: (\d+))?/, function (t, c) {
    return t + c + this.last.groups.tag;
}, '1']]);
  ['get /x', 'put /y {"a":1}', 'ab', 'a', 'abc', '#tag 22', '#tag', 'get', 'none of them',
    'put /z {}', 'zz', '#x 1'].forEach(function (t, i) {
    for (var k = 0; k < 3; k++) say(i, k, o.find(k === 1 ? t.slice(0,
      -1) : k === 2 ? t + ' ' : t));
});
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
function xmlEventsDocumentsRun(lib) {
  var docs = ['<a/>',
    '<?xml version="1.0"?><!DOCTYPE a><r x="1" y=\'two\'><b>t &amp; &#65;&#x1F600;</b><!-- c --><c><![CDATA[<raw>&]]></c></r>',
    '<a><b></a></b>', '<a b=c d>x</a>', '<a b="1" b="2"/>', '<1>', '<a>&unknown; &lt;</a>',
    '<open><in>', '</x>', 'text only', '<n:s xmlns:n="u"><n:t/></n:s>', '<a / b="1"></a >', ''];
  docs.forEach(function (d, i) {
    [false, true].forEach(function (s) {
      try {
        var t = lib.tree(d, s);
        say(i, s, JSON.stringify(t.children), t.errors.join(';'), lib.write(t));
    } catch (e) {
        say(i, s, e.message);
      }
  });
});
}
function xmlEventsChunkedRun(lib) {
  var xml = '<list n="3">\n' + Array.from({ length: 9 }, function (_, i) {
    return '<item id="' + i + '" k=\'v&quot;' + i + '\'>t' + i + (i % 3 ? '<br/>' : '<!--c' + i + '-->') + '</item>';
}).join('\n') + '</list>';
  for (var size = 1; size < 30; size += 3) {
    var log = [], p = new lib.Sax(true, { onopen: function (t) {
      log.push('<' + t.name + Object.keys(t.attrs).map(function (k) {
        return k + t.attrs[k];
    }).join());
  }, onclose: function (n) {
      log.push('/' + n);
  }, ontext: function (t) {
      if (t.trim()) log.push(t.trim());
  }, oncomment: function (c) {
      log.push('!' + c);
    }
  });
    for (var i = 0; i < xml.length; i += size) p.write(xml.slice(i, i + size));
    p.end();
    say(size, log.length, log.slice(size % 5, size % 5 + 6).join(' '),
      JSON.stringify(p.counts), p.line, p.col, p.pos);
  }
}
for (let round = 0; round < 4; round++) {
  cLexerSourcesRun(cLexer);
  cLexerCountsRun(cLexer);
  logLinesMixedRun(logLines);
  logLinesLongRunRun(logLines);
  logLinesPatternsChangeRun(logLines);
  matrixNestsKindsRun(matrixNests);
  matrixNestsImagesRun(matrixNests);
  writtenRoutesRequestsRun(writtenRoutes);
  writtenRoutesAddedLateRun(writtenRoutes);
  writtenRoutesOldLayersRun(writtenRoutes);
  layeredOptionsCopiesRun(layeredOptions);
  layeredOptionsClientsRun(layeredOptions);
  xmlEventsDocumentsRun(xmlEvents);
  xmlEventsChunkedRun(xmlEvents);
  output.first = false;
  console.log("round", round, output.lines, output.hash);
}
