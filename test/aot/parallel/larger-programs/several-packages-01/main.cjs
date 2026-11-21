// Several packages in one program: counters-widen, handle-bars, pack-codes, wild-bus, trie-router, color-reader, in two modules
const { output, say, countersWiden, handleBars, packCodes, wildBus, trieRouter, colorReader } = require("./lib.cjs");
function countersWidenMetersRun(lib) {
  var ms = [new lib.Meter(), new lib.Wide(), new lib.Wide()], xs = [1, 5, -3, 2147483647, 1,
    0.5, -0, 1e10, NaN, -2147483648, Infinity, 3];
  for (var i = 0; i < 36; i++) {
    var m = ms[i % 3], x = xs[(i * 5 + (i / 12 | 0)) % 12];
    m.add(x);
    if (i % 7 === 6) m.scale(i % 2 ? 0.5 : -1);
    if (i % 11 === 10) m.reset();
    if (i === 17) m.label = 'text';
    if (i === 25) m.total = '7';
    if (i === 29) m.n = 2 ** 31 - 1;
    say(i, m.total, m.n, Object.is(m.last, -0) ? '-0' : m.last, m.low, m.high, m.flags, m.mean,
      m.step(), m.extra, m.wrap ? m.wrap() : '-', m.label);
  }
  say(JSON.stringify(ms), lib.sum(ms, 'n'), lib.sum(ms, 'flags'), lib.sum(ms, 'none'),
    Object.keys(ms[1]).join());
}
function countersWidenOldRecordsRun(lib) {
  var os = [];
  for (var i = 0; i < 12; i++) os.push(new lib.Old(i % 3 ? i : i * 1e9,
    i % 4 === 3 ? 0.25 : i));
  for (var n = 0; n < 5; n++) os.forEach(function (o, i) {
    if (n === 2 && i === 4) delete o.b;
    if (n === 3 && i === 5) o.a = 'q';
    if (n === 3 && i === 6) o.b = 10n;
    var r;
    try {
      r = o.next();
  } catch (e) {
      r = e.name;
    }
    say(n, i, String(r), String(o.a), String(o.b), o.mark('m' + n, i), o.mark('z',
      i % 2 ? 0.5 : 2147483647), Object.keys(o).join(''));
});
  say(String(lib.sum(os, 'a')), lib.sum(os, 'm1'), lib.Old.zero.next(), lib.Old.zero.a,
    JSON.stringify(Object.assign(new lib.Old(1, 2), { a: 1.5, d: -0 })), 1 / Object.assign({},
    { d: -0 }).d);
}
function countersWidenNanStepsRun(lib) {
  function walk(from, to, step) {
    var out = [], x = from, n = 0;
    while (x < to) {
      out.push(x);
      x += step;
      if (++n > 12) break;
    }
    return out.join() + ' end ' + x;
  }
  function count(o) {
    var n = 0;
    for (o.i = 0; o.i < o.max; o.i += o.by) {
      n++;
      if (n > 20) return 'many ' + o.i;
    }
    return n + ' ' + o.i;
  }
  var steps = [1, 2, 0.5, NaN, -1, 0, Infinity, 1e9, 2 ** 31, '1', null, undefined, true, -0];
  steps.forEach(function (s, i) {
    say(i, walk(0, 5, s), '|', walk(2147483640, 2147483650, s), '|', walk(-3, i, s), '|',
      count({ max: 6, by: s }), '|', count({ max: i % 2 ? 4.5 : '3', by: s }));
});
  for (var k = 0; k < 6; k++) {
    var o = {
      max: 4, by: 1, get i() {
        return this._i;
    }, set i(v) {
        this._i = k > 3 ? v + 0.5 : v;
      }
  };
    say(k, count(o), o._i);
  }
}
function handleBarsBlocksRun(lib) {
  const e = new lib(), data = {
    title: 'T <1>', on: true, none: [], list: [{ n: 1, sub: ['a', 'b'] }, { n: 2, sub: [] }],
      o: {
      x: 'X', y: {
        z: 'Z'
      }
  }, f() {
      return this.title.length;
  }, html: '<i>', zero: 0, nil: null
};
  const ts = ['{{title}} {{{title}}} {{&html}}',
    '{{#if on}}yes{{else}}no{{/if}}{{#if none}}a{{else if zero}}b{{else}}c{{/if}}',
    '{{#each list}}{{@index}}:{{n}}{{#each sub}}[{{this}}{{../n}}{{@first}}]{{else}}-{{/each}} {{/each}}',
    '{{#each o as |v k|}}{{k}}={{v.z}}{{v}};{{/each}}',
    '{{#with o.y}}{{z}}{{../title}}{{@root.html}}{{/with}}',
    '{{#list}}{{n}}{{/list}}{{^none}}none{{/none}}{{^list}}x{{/list}}',
    'a  {{~title~}}  b {{! c }}{{!-- {{x}} --}}d',
    '{{f}} {{missing.deep.path}} {{o.[x]}} {{zero}}{{nil}}', '{{#unless on}}u{{/unless}}',
    '{{#if on}}', '{{/if}}', '{{nohelper 1}}', '{{#on}}{{title}}{{/on}}', ''];
  for (let n = 0; n < 3; n++) ts.forEach((t, i) => {
    try {
      say(n, i, JSON.stringify(e.render(t, n ? { ...data, on: n === 2,
        list: data.list.slice(n), none: n === 2 ? ['q'] : [] } : data)));
  } catch (x) {
      say(n, i, x.name, x.message);
    }
});
  say(e.compiled);
}
function handleBarsHelpersRun(lib) {
  const e = new lib();
  e.helper('join', function (list, sep, o) {
    return list.map(x => o.fn ? o.fn(x) : x).join(sep) + (o.hash.end ?? '');
}).helper('add', (...a) => a.slice(0, -1).reduce((s, x) => s + x, 0)).helper('safe',
  s => ({ html: '<b>' + s + '</b>' })).helper('self', function () {
    return typeof this + Object.keys(this).length;
}).partial('row', '({{n}}{{#if more}}{{> row more}}{{/if}}{{x}})').partial('loop',
  '{{> loop}}');
  const ts = ['{{join list ", " end="!"}}', '{{#join list "-"}}<{{this}}>{{/join}}',
    '{{add 1 2.5 n}} {{add (add n 1) (add 2 3)}}', '{{safe name}}{{{safe name}}}',
    '{{> row x="X"}}', '{{> row o}}{{> row o x=name}}', '{{self}}', '{{> nothing}}',
    '{{> loop}}', '{{add "a" true null}}'];
  for (let i = 0; i < 4; i++) {
    if (i === 2) e.partial('row', '[{{n}}]');
    if (i === 3) e.helper('add', function (a, b) {
      return this.n * a;
  });
    ts.forEach((t, k) => {
      try {
        say(i, k, e.render(t, { list: ['a', i, 'c<'].slice(i % 2), n: i, name: 'N&' + i,
          o: { n: 'on', more: { n: 'deep', more: i % 2 ? { n: 'deeper' } : null } } }));
    } catch (x) {
        say(i, k, x.name, x.message);
      }
  });
  }
  say(e.compiled, [...e.cache.keys()].join());
}
function packCodesTextsRun(lib) {
  const texts = ['', 'a', 'aaaa', 'abracadabra', 'TOBEORNOTTOBEORTOBEORNOT',
    'the rain in spain falls mainly on the plain, the rain in spain', 'x'.repeat(70) + 'yx',
    'é and ü: éüéü', '01'.repeat(30), 'mississippi river ' + 'mississippi'];
  for (let n = 0; n < 3; n++) texts.forEach((t, i) => {
    t = n ? t + t.slice(0, n * 5) : t;
    const h = lib.huffman(t), l = lib.lzw(t), z = lib.lz77(t), r = lib.rle(t), b = lib.bwt(t);
    say(n, i, h.bits.bytes.length, h.bits.n, [...h.codes].slice(0,
      6).map(c => c.join('')).join(), lib.unhuffman(h) === t, l.length, l.slice(0, 8).join(),
      lib.unlzw(l) === t, JSON.stringify(z.slice(0, 12)), lib.unlz77(z) === t, r.length,
      lib.unrle(r) === t, JSON.stringify(b.slice(0, 20)), lib.unbwt(b) === t);
});
  try {
    lib.unlzw([65, 999]);
} catch (e) {
    say(e.message);
  }
  say(lib.mtf('bananaaa').join(), lib.mtf(lib.bwt('abracadabra')).join());
}
function packCodesBitsRun(lib) {
  const b = new lib.Bits();
  let seed = 9;
  const put = [];
  for (let i = 0; i < 90; i++) {
    seed = seed * 16807 % 2147483647;
    const w = 1 + seed % 17, v = seed & (1 << w) - 1;
    b.put(v, w);
    put.push([v, w]);
  }
  say(b.n, b.bytes.length, b.bytes.slice(0, 10).join());
  let bad = 0;
  for (const [v, w] of put) if (b.get(w) !== v) bad++;
  say(bad, b.at, b.at === b.n);
  for (let i = 0; i < 12; i++) {
    const c = new lib.Bits();
    for (let k = 0; k <= i; k++) c.put(k * 0x5555 ^ i, k + 1);
    say(i, c.n, c.bytes.map(x => x.toString(16)).join(' '), c.get(i + 1), c.get(3),
      new lib.Bits(c.bytes).get(8));
  }
}
function wildBusNamesRun(lib) {
  const b = new lib(), log = [];
  const rec = t => function (...a) {
    log.push(t + ':' + a.join('/') + (this === b ? '' : '@' + this.id));
};
  b.on('user.login', rec('a')).on('user.*', rec('b')).on('**', rec('c')).on('user.**',
    rec('d')).once('user.login', rec('once')).prepend('user.login', rec('pre')).on('*.login',
    rec('e'), { id: 7 });
  ['user.login', 'user.login', 'user', 'user.x.y', 'admin.login', 'other', 'user.logout',
    'a.b.c.d', 'user.*'].forEach((n, i) => {
    log.length = 0;
    say(n, b.emit(n, i, 'x' + i), b.count(n), log.join(' '));
});
  try {
    b.emit('error', 'lost');
} catch (e) {
    say(e.message);
  }
  const lone = new lib();
  try {
    lone.emit('error', new RangeError('r'));
} catch (e) {
    say(e.name);
  }
  try {
    lone.emit('error', 5);
} catch (e) {
    say(e.message);
  }
  try {
    lone.on('x', 5);
} catch (e) {
    say(e.message);
  }
  say(lone.emit('x'));
}
function wildBusWhileEmittingRun(lib) {
  const b = new lib({ sep: ':', max: 3 }), log = [];
  function self() {
    log.push('self');
    b.off('t:x', self);
  }
  function add() {
    log.push('add');
    if (log.length < 8) b.on('t:x', () => {
      log.push('added');
  });
  }
  let stop = false;
  b.on('newListener', n => log.push('new ' + n));
  b.on('t:x', self).on('t:x', add).on('t:x', () => {
    log.push('mid');
    return stop ? lib.STOP : undefined;
}).on('t:*', () => {
    log.push('star');
    throw new Error('thrown ' + log.length);
});
  for (let i = 0; i < 12; i++) {
    if (i === 6) stop = true;
    if (i === 9) b.off('t:*');
    if (i === 10) b.off('t:x');
    let r;
    try {
      r = b.emit('t:x', i);
  } catch (e) {
      r = e.message;
    }
    say(i, r, log.splice(0).join(' '), b.count('t:x'), b.warned.join());
  }
}
function wildBusAnswersRun(lib) {
  const b = new lib();
  b.on('sum', (x, y) => x + y);
  b.on('sum', function (x, y) {
    return this.k * x * y;
}, { k: 2 });
  b.on('*', x => typeof x);
  const list = [1, 2.5, 'a', 10n, null, [1], NaN, -0, true];
  for (let i = 0; i < 20; i++) {
    let r;
    try {
      r = b.ask('sum', list[i % 9], list[(i * 4) % 9]);
  } catch (e) {
      r = [e.constructor.name];
    }
    say(i, r.map(String).join(' '), r.length, b.ask('none' + i).join());
    if (i === 11) b.once('sum', () => 'third');
  }
}
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
function colorReaderTextsRun(lib) {
  ['#f0a', '#F0A8', '#336699', '#33669980', 'rgb(1, 2, 3)', 'rgb(10% 20% 30% / 50%)',
    'rgba(255,128,0,.25)', 'hsl(120, 100%, 25%)', 'hsl(-60deg 50% 50% / 0.5)',
    'hsl(0.5turn,10%,90%)', 'hsla(3.14rad 20% 30%)', 'Teal', ' navy ', 'rebecca', '#12',
    'rgb(1,2)', 'constructor', 'hsl(1,2,3)', ''].forEach(function (t) {
    for (var i = 0; i < 2; i++) try {
      var c = new lib(i ? t.toUpperCase() : t);
      say(t, c.kind, c.hex(), c.c.map(function (v) {
        return v.toFixed(3);
    }).join(), c.luminance.toFixed(5), c.groups);
  } catch (e) {
      say(e.name, e.message);
    }
});
}
function colorReaderMixesRun(lib) {
  var list = ['#f00', 'rgb(0,0,255)', 'hsl(90,50%,50%)', '#abcdef80', 'teal'];
  for (var i = 0; i < 25; i++) {
    var a = new lib(list[i % 5]), b = new lib(list[(i * 3 + 1) % 5]), m = a.mix(b, i / 24);
    say(i, m.hex(), m.kind, m.luminance.toFixed(6), m.mix(a, .5).hex());
    if (i === 10) lib.readers.unshift({ re: /^#(f)(0)(0)$/, read: function (g) {
      return [1, 2, 3, g.length / 8];
    }
  });
    if (i === 18) lib.readers.shift();
  }
}
for (let round = 0; round < 4; round++) {
  countersWidenMetersRun(countersWiden);
  countersWidenOldRecordsRun(countersWiden);
  countersWidenNanStepsRun(countersWiden);
  handleBarsBlocksRun(handleBars);
  handleBarsHelpersRun(handleBars);
  packCodesTextsRun(packCodes);
  packCodesBitsRun(packCodes);
  wildBusNamesRun(wildBus);
  wildBusWhileEmittingRun(wildBus);
  wildBusAnswersRun(wildBus);
  trieRouterMixedRun(trieRouter);
  trieRouterGrowsRun(trieRouter);
  colorReaderTextsRun(colorReader);
  colorReaderMixesRun(colorReader);
  output.first = false;
  console.log("round", round, output.lines, output.hash);
}
