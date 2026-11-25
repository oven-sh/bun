// Several packages in one program: fraction-kit, text-tables, sorted-tree, written-routes, handle-bars, route-tables, in two modules
const { output, say, fractionKit, textTables, sortedTree, writtenRoutes, handleBars, routeTables } = require("./lib.cjs");
function fractionKitFractionsRun(lib) {
  const F = lib.Fraction, list = ['1/3', '-0.75', 0.1, 5n, '0.1(6)', '22/7', '-3', 2 ** -20,
    '123456789012345678901234567890/7', '0.(142857)'];
  let acc = new F(0n);
  for (let i = 0; i < 30; i++) {
    const a = F.of(list[i % 10]), b = F.of(list[(i * 3 + 1) % 10]);
    acc = i % 4 === 3 ? acc.mul(b.sub(a)) : i % 4 === 2 && acc.n ? a.div(acc) : acc.add(a);
    if (String(acc).length > 60) acc = new F(acc.floor() % 97n, 7n);
    say(i, acc, acc.decimal(), a.cmp(b), a.pow(i % 5 - 2), acc.floor(), a > b, +b, `${a}`,
      a + b > 1, JSON.stringify(acc));
  }
  for (const bad of ['x', '1/0', NaN, '1.2.3', Infinity, '']) try {
    say(F.of(bad));
} catch (e) {
    say(e.name, e.message);
  }
  try {
    acc.n = 5n;
} catch (e) {
    say(e.name);
  }
  say(F.of('415/93').continued().join(), F.convergents(F.of(Math.PI).continued(8)).join(' '),
    F.of('-7/3').continued().join());
}
function fractionKitNumbersRun(lib) {
  for (let i = 0n; i < 24n; i++) {
    const n = (i * 1234567891n) ** (i % 5n + 1n) + i, p = 1000003n;
    say(i, lib.modpow(n, i * 7n + 3n, p), lib.isPrime(i), lib.isPrime((1n << i) - 1n),
      lib.isqrt(n), lib.isqrt(n * n) === n, lib.toBase(n), lib.fromBase(lib.toBase(n)) === n,
      lib.toBase(n, '01').length, lib.gcd(n, 360360n), n.toString(36), BigInt.asIntN(32, n),
      BigInt.asUintN(16, -n));
    try {
      say(lib.inverse(i, 12n));
  } catch (e) {
      say(e.message);
    }
  }
  say(lib.pi(50));
  say(lib.isPrime(2n ** 61n - 1n), lib.isPrime(2n ** 67n - 1n), [...'0OIl'].map(c => {
    try {
      return lib.fromBase('1' + c);
  } catch (e) {
      return e.message;
    }
}).join());
  say([7n, -7n].map(a => [2n, -2n].map(b => [a / b, a % b, a << b, a >> b, a & b, a | b, a ^ b,
    ~a].join()).join(' ')).join(' | '), 1n < 1.5, 2n == '2', 1n + BigInt(true),
    typeof Object(1n), [3n, 1, 2n, '0'].sort().join());
}
function textTablesTablesRun(lib) {
  var rows = [['name', 'n', 'note'], ['a', 1, 'two\nlines'], ['日本語', 22.5, null],
    ['\u001b[1mbold\u001b[0m', -3, 'a long note that must be wrapped somewhere'], [true]];
  [{}, { head: true, align: ['left', 'right', 'center'] }, { max: 8, head: true }, { max: 3,
    align: ['right'] }].forEach(function (o) {
    for (var n = 1; n <= rows.length; n += 2) say(lib.table(rows.slice(0, n).map(function (r) {
      return r.slice();
  }), o));
});
  [5, 12, 20, 40].forEach(function (w) {
    ['The quick brown fox jumps', 'averyveryverylongword in it', '', 'two\nparas here  spaced',
      '日本語 テキスト'].forEach(function (t) {
      say(w, JSON.stringify(lib.wrap(t, w)), JSON.stringify(lib.wrap(t, w, { hard: true,
        indent: '  ', first: '* ' })));
  });
});
}
function textTablesDistancesRun(lib) {
  var list = ['kitten', 'sitting', '', 'abc', 'acb', 'saturday', 'sunday', 'ab', 'ba',
    'xabxcdxx', 'abcd'];
  list.forEach(function (a, i) {
    say(a, list.map(function (b) {
      return lib.distance(a, b) + '/' + lib.distance(a, b, true);
  }).join(' '), lib.lcs(a.split(''), list[(i + 1) % list.length].split('')).map(function (x) {
      return x.join('');
  }).join(''));
});
  ['fooBar baz', 'HTTPServer2Go', 'snake_case_here', 'kebab-case', 'Ünïcödé Text!', '  ',
    'a1b2', 'XMLHttpRequest', 'ß straße'].forEach(function (s) {
    say(Object.keys(lib.cases).map(function (k) {
      return k + '=' + lib.cases[k](s);
  }).join(' | '), lib.words(s).join());
});
}
function textTablesRopesRun(lib) {
  var r = new lib.Rope(''), plain = '';
  for (var i = 0; i < 160; i++) {
    var t = ['x' + i, 'some longer text ' + i, '', '\n'][i % 4],
      at = (i * 37) % (plain.length + 1);
    if (i % 3 === 0) {
      r = r.concat(t);
      plain += t;
  } else if (i % 7 === 5) {
      var e = Math.min(plain.length, at + 9);
      r = r.slice(0, at).concat(r.slice(e, r.length));
      plain = plain.slice(0, at) + plain.slice(e);
  } else {
      r = r.insert(at, t);
      plain = plain.slice(0, at) + t + plain.slice(at);
    }
    if (i % 16 === 15) say(i, r.length, r.depth, r.toString() === plain, r.leaves([]).length,
      JSON.stringify(r.charAt(at >> 1)), JSON.stringify(r.slice(3, 20).toString()),
      r.balance().toString() === plain);
  }
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
function routeTablesUrlsRun(lib) {
  const t = new lib.Table(), urls = ['/item/1', '/item/22/edit', '/item/22/copy/name',
    '/tag/a', '/tag/a/b/c', '/about', '/de/about.txt', '/x', '/x-1', '/x-1-2-3-4', '/item/x',
    'none', '/', '/fr/about#top', '/x-a-b#/x-c'];
  for (let n = 0; n < 4; n++) urls.forEach((u, i) => {
    const v = n === 0 ? u : n === 1 ? u.replace(/\d/g,
      d => 9 - d) : n === 2 ? ('http://h' + u).slice(8) : u + (i % 2 ? '' : '#' + i);
    say(n, i, JSON.stringify(t.find(v)), t.kept.length);
});
  say(t.hits.join(), t.groups().join(), t.kept.map(m => m[0] + m.length).join(' '),
    t.first(urls), t.first(['/item/9/copy', 'q']), t.first(['q']));
}
function routeTablesChangedTablesRun(lib) {
  const rows = lib.TABLE.slice(0, 5);
  const t = new lib.Table(rows);
  for (let i = 0; i < 30; i++) {
    if (i === 8) rows.unshift([/^\/item\/(\w)(\w)?(\w)?$/, 'letters', ['p', 'q', 'r']]),
      t.hits.unshift(0);
    if (i === 14) rows[1][0].exec = function () {
      return ['own', String(i)];
  };
    if (i === 18) delete rows[1][0].exec;
    if (i === 22) rows[2] = [new RegExp('^/(i)tem/(\\d+)'), 'made', ['i', 'n']];
    const u = ['/item/' + i, '/item/ab', '/item/' + i + '/edit', '/x-' + i % 10, '/en/about',
      '/tag/' + i + '/z'][i % 6];
    let r;
    try {
      r = JSON.stringify(t.find(u));
  } catch (e) {
      r = e.name;
    }
    say(i, u, r, t.hits.join(), t.groups().slice(-3).join());
  }
}
function routeTablesLexedRun(lib) {
  const texts = ['let x1 = 3.14 + y', 'f("a\\"b", 12) => { return !ok; }', '', '  ',
    'a.b[0] >= "x" && c', '"" 5', 'é @', '"open', 'n=1,m=2', 'for(;;)i+=2'];
  for (let n = 0; n < 3; n++) texts.forEach((s, i) => {
    const v = n === 0 ? s : n === 1 ? s + ' ' + texts[(i + 1) % 10] : s.repeat(2);
    say(n, i,
      lib.tokens(v).map(t => t.k[0] + t.text + (t.extra.length ? JSON.stringify(t.extra) : '')).join(' '));
});
  ['key: value', 'k=', '- [x] done', '* item', '- [ ] todo', '## Title {id}', '# T',
    'one two three', 'one', '', 'a  b'].forEach((l, i) => ['pair', 'list', 'head',
    'other'].forEach(k => say(i, k, JSON.stringify(lib.fields(l, k)),
    JSON.stringify(lib.fields(i % 2 ? l + i : l.slice(0, -1), k)))));
}
for (let round = 0; round < 4; round++) {
  fractionKitFractionsRun(fractionKit);
  fractionKitNumbersRun(fractionKit);
  textTablesTablesRun(textTables);
  textTablesDistancesRun(textTables);
  textTablesRopesRun(textTables);
  sortedTreeNumbersRun(sortedTree);
  sortedTreeTextsRun(sortedTree);
  writtenRoutesRequestsRun(writtenRoutes);
  writtenRoutesAddedLateRun(writtenRoutes);
  writtenRoutesOldLayersRun(writtenRoutes);
  handleBarsBlocksRun(handleBars);
  handleBarsHelpersRun(handleBars);
  routeTablesUrlsRun(routeTables);
  routeTablesChangedTablesRun(routeTables);
  routeTablesLexedRun(routeTables);
  output.first = false;
  console.log("round", round, output.lines, output.hash);
}
