// Rules over facts: patterns with variables, joins that are kept, an agenda by priority and age, actions that assert and retract, truth that is kept, explanations, queries, in two modules
const { Fact, Pattern, Rule, Activation, Engine, P, not } = require("./lib.cjs");
var family = new Engine();
family.rule('parents are ancestors', [P('parent', { a: '?x', b: '?y' })], function (e) {
  this.assert('ancestor', { a: e['?x'], b: e['?y'] });
}, { logical: true }).rule('ancestors chain', [P('parent', { a: '?x', b: '?y' }), P('ancestor',
  { a: '?y', b: '?z' })], function (e) {
  this.assert('ancestor', { a: e['?x'], b: e['?z'] });
}, { logical: true }).rule('siblings', [P('parent', { a: '?p', b: '?x' }), P('parent',
  { a: '?p', b: '?y' }, { guard: function (e) {
  return e['?x'] !== e['?y'];
}
})], function (e) {
  this.assert('sibling', { a: e['?x'], b: e['?y'] });
}, { logical: true, priority: 5 }).rule('only children', [P('person', { name: '?x' }),
  not('sibling', { a: '?x' })], function (e) {
  this.assert('only', { name: e['?x'] });
}, { logical: true, priority: -5 });
var counts = {
  assert: 0, retract: 0, fire: 0
};
Object.keys(counts).forEach(function (k) {
  family.on(k, function () {
    counts[k]++;
});
});
'ann bob cid dot eve fay gus'.split(' ').forEach(function (n) {
  family.assert('person', { name: n });
});
[['ann', 'bob'], ['ann', 'cid'], ['bob', 'dot'], ['dot', 'eve'], ['cid', 'fay'], ['cid',
  'gus']].forEach(function (p) {
  family.assert('parent', { a: p[0], b: p[1] });
});
console.log(family.run(), JSON.stringify(counts),
  family.ofType('ancestor').map(String).sort().join(' '));
console.log(family.ofType('only').map(String).sort().join(' '), family.query(P('ancestor',
  { a: 'ann', b: '?d' }), not('parent', { a: '?d' })).map(function (e) {
  return e['?d'];
}).sort().join());
console.log(family.explain(family.keys.get('ancestor:a=stringann;b=stringeve')));
family.retract(family.keys.get('parent:a=stringbob;b=stringdot'));
family.run();
console.log(JSON.stringify(counts), family.ofType('ancestor').length,
  family.ofType('only').map(String).sort().join(' '));
var shop = new Engine(), bills = [];
shop.rule('line totals', [P('line', { order: '?o', sku: '?s', n: '?n' }), P('price',
  { sku: '?s', cents: '?c' })], function (e) {
  this.assert('total', { order: e['?o'], sku: e['?s'], cents: e['?n'] * e['?c'] });
}, { logical: true, priority: 10 }).rule('unknown goods', [P('line', { order: '?o',
  sku: '?s' }), not('price', { sku: '?s' })], function (e) {
  this.assert('problem', { order: e['?o'], what: 'no price of ' + e['?s'] });
}, { logical: true, priority: 8 }).rule('bulk', [P('line', { order: '?o', sku: '?s',
  n: function (n) {
  return n >= 10;
}
})], function (e) {
  this.assert('discount', { order: e['?o'], percent: 5 });
}, { logical: true, priority: 7 }).rule('gold customers', [P('order', { id: '?o',
  customer: '?c' }), P('customer', { name: '?c', level: 'gold' })], function (e) {
  this.assert('discount', { order: e['?o'], percent: 10 });
}, { logical: true, priority: 7 }).rule('bill', [P('order', { id: '?o', state: 'open' },
  { as: 'order' }), not('problem', { order: '?o' })], function (e) {
  var sum = this.query(P('total', { order: e['?o'], cents: '?c' })).reduce(function (s, x) {
    return s + x['?c'];
}, 0), best = this.query(P('discount', { order: e['?o'], percent: '?p' })).reduce(function (m,
  x) {
    return Math.max(m, x['?p']);
}, 0);
  bills.push(e['?o'] + ':' + Math.round(sum * (100 - best) / 100));
  this.modify(e.order, { state: 'billed' });
}, { priority: -1 }).rule('complain', [P('problem', { order: '?o', what: '?w' })],
  function (e) {
  this.log.push(e['?o'] + ' ' + e['?w']);
}, { priority: -2 }).rule('broken', [P('customer', { level: 'odd' })], function () {
  throw new TypeError('odd customer');
});
for (var i = 0; i < 12; i++) shop.assert('price', { sku: 's' + i, cents: 100 + i * 35 });
['gold', 'plain', 'odd'].forEach(function (l, k) {
  shop.assert('customer', { name: 'c' + k, level: l });
});
for (i = 0; i < 45; i++) {
  shop.assert('order', { id: 'o' + i, customer: 'c' + (i % 3), state: 'open' });
  for (var k = 0; k < 1 + i % 3; k++) shop.assert('line', { order: 'o' + i,
    sku: 's' + ((i * 5 + k * 3) % 13), n: 1 + (i * 7 + k) % 12 });
  if (i % 9 === 8) shop.run();
}
shop.run();
console.log(bills.length, bills.slice(0, 6).join(' '), bills.reduce(function (s, b) {
  return s + +b.split(':')[1];
}, 0));
console.log(shop.log.join('; '), shop.steps, shop.facts.size, shop.rules.map(function (r) {
  return r.name + '=' + r.fired;
}).join(' '));
shop.assert('price', { sku: 's12', cents: 999 });
shop.run();
console.log(bills.length, shop.ofType('problem').length, shop.agenda.length);
var endless = new Engine();
endless.rule('more', [P('n', { v: '?v' })], function (e) {
  this.assert('n', { v: e['?v'] + 1 });
}).assert('n', { v: 0 });
try {
  endless.run(200);
} catch (e) {
  console.log(e.name, e.message, endless.facts.size);
}
try {
  endless.rule('more', [], function () {
});
} catch (e) {
  console.log(e.message);
}
try {
  endless.on('x', null);
} catch (e) {
  console.log(e.message);
}
var sorted = new Engine();
sorted.rule('swap', [P('at', { i: '?i', v: '?a' }, { as: 'x' }), P('at', { i: '?j', v: '?b' },
  { as: 'y', guard: function (e) {
  return e['?j'] === e['?i'] + 1 && e['?b'] < e['?a'];
}
})], function (e) {
  var i = e['?i'], a = e['?a'], b = e['?b'];
  this.retract(e.x);
  this.retract(e.y);
  this.assert('at', { i: i, v: b });
  this.assert('at', { i: i + 1, v: a });
});
for (i = 0; i < 16; i++) sorted.assert('at', { i: i, v: (i * 7) % 16 });
console.log(sorted.run(), sorted.ofType('at').sort(function (a, b) {
  return a.fields.i - b.fields.i;
}).map(function (f) {
  return f.fields.v;
}).join());
