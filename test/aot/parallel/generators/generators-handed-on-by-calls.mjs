// STATISTIC: GeneratorsHandedOnByCalls >= 8
// A generator that is handed on by a call, and not made by it, is stepped where it stands: what a lookup in a Map, a method, a closure, a memo or a list gives is the one that others hold.
function* steps(n) { yield 1; yield n; }
function* counts(n) { for (let i = 0; i < n; i++) yield i; }
const walk = data => { let sum = 0; for (const v of data) { sum += v; break; } return sum; };
const all = data => { let sum = 0; for (const v of data) sum += v; return sum; };
const spread = data => [...data].join();
const pattern = ([a, b]) => `${a}/${b}`;
const next = data => { const r = data.next(); return r.value + ":" + r.done; };
function byHand(data) { let n = 0; for (let r = data.next(); !r.done; r = data.next()) n += r.value; return n; }
const id = data => data;
function* relay(g) { yield* id(g); }
function named(g) { return g; }
const lists = data => Array.from(data).join();
class Box { constructor(g) { this.g = g; } get() { return this.g; } get got() { return this.g; } }
const kept = [];
function keep() { const g = steps(5); kept.push(g); return g; }
let memo; function once() { memo ??= steps(6); return memo; }
let latest; function latestOf() { latest = counts(4); return latest; }
const says = [];
const say = (name, run) => { let text; try { text = String(run()); } catch (error) { text = error.constructor.name; } says.push(name + ' ' + text); };
const forms = {
  mapLiteral() { const map = new Map([['k', steps(4)]]); return walk(map.get('k')) + ' ' + next(map.get('k')); },
  mapSet() { const map = new Map(); map.set('k', steps(4)); return walk(map.get('k')) + ' ' + next(map.get('k')) + ' ' + all(map.get('k')); },
  mapLocal() { const it = steps(4), map = new Map([['k', it]]); return walk(map.get('k')) + ' ' + walk(map.get('k')) + ' ' + walk(it); },
  mapAll() { const map = new Map([['k', counts(4)]]); return all(map.get('k')) + ' ' + all(map.get('k')); },
  mapSpread() { const map = new Map([['k', counts(4)]]); return spread(map.get('k')) + ' ' + spread(map.get('k')); },
  mapPattern() { const map = new Map([['k', counts(4)]]); return pattern(map.get('k')) + ' ' + spread(map.get('k')); },
  mapByHand() { const map = new Map([['k', counts(4)]]); return byHand(map.get('k')) + ' ' + byHand(map.get('k')); },
  mapAsk() { const map = new Map([['k', steps(4)]]); return [...map.get('k')].length + ' ' + [...map.get('k')].length; },
  mapForOf() { const map = new Map([['k', counts(4)]]); let n = 0; for (const v of map.get('k')) { n += v; if (v === 1) break; } for (const v of map.get('k')) n += 100 + v; return n; },
  mapSame() { const map = new Map([['k', steps(4)]]); const a = map.get('k'); walk(map.get('k')); return (a === map.get('k')) + ' ' + next(a); },
  mapLoop() { const map = new Map([['k', counts(6)]]); let n = 0; for (let i = 0; i < 4; i++) n = n * 10 + walk(map.get('k')); return n; },
  objectKey() { const key = {}, map = new Map([[key, steps(4)]]); return walk(map.get(key)) + ' ' + next(map.get(key)); },
  weak() { const key = {}, map = new WeakMap([[key, steps(4)]]); return walk(map.get(key)) + ' ' + next(map.get(key)); },
  identity() { const g = steps(4); return walk(id(g)) + ' ' + next(g) + ' ' + next(id(g)); },
  identityTwice() { const g = counts(5); return walk(id(g)) + ' ' + all(id(g)) + ' ' + spread(g); },
  box() { const box = new Box(steps(4)); return walk(box.get()) + ' ' + next(box.get()); },
  boxAll() { const box = new Box(counts(4)); return all(box.get()) + ' ' + all(box.get()); },
  boxGetter() { const box = new Box(steps(4)); return walk(box.got) + ' ' + next(box.got); },
  boxField() { const box = new Box(steps(4)); return walk(box.g) + ' ' + next(box.g); },
  closure() { const g = steps(4), get = () => g; return walk(get()) + ' ' + next(get()); },
  closureMade() { const get = (g => () => g)(counts(3)); return all(get()) + ' ' + all(get()); },
  kept() { kept.length = 0; const n = walk(keep()); return n + ' ' + next(kept[0]); },
  keptAll() { kept.length = 0; const n = all(keep()); return n + ' ' + all(kept[0]); },
  once() { memo = undefined; return walk(once()) + ' ' + next(once()); },
  latest() { const n = walk(latestOf()); return n + ' ' + next(latest) + ' ' + spread(latest); },
  at() { const list = [steps(4)]; return walk(list.at(0)) + ' ' + next(list.at(0)); },
  pop() { const g = steps(4), list = [g, g]; return walk(list.pop()) + ' ' + next(list.pop()); },
  find() { const list = [counts(4)]; return all(list.find(() => true)) + ' ' + all(list.find(() => true)); },
  call() { const g = steps(4); return walk(id.call(null, g)) + ' ' + next(g); },
  apply() { const g = steps(4); return walk(Reflect.apply(id, null, [g])) + ' ' + next(g); },
  bound() { const g = steps(4), b = id.bind(null, g); return walk(b()) + ' ' + next(b()); },
  self() { const g = steps(4); return walk(g[Symbol.iterator]()) + ' ' + next(g) + ' ' + (g[Symbol.iterator]() === g); },
  objectValue() { const o = { g: counts(3) }; return all(Object.values(o)[0]) + ' ' + all(Object.values(o)[0]); },
  assign() { const o = Object.assign({}, { g: counts(3) }); return all(o.g) + ' ' + all(o.g); },
  relayed() { const g = counts(4); return walk(relay(id(g))) + ' ' + next(g); },
  relayedMap() { const map = new Map([['k', counts(4)]]); return all(relay(map.get('k'))) + ' ' + next(map.get('k')); },
  namedTwice() { const g = counts(4); return walk(named(named(g))) + ' ' + all(named(g)) + ' ' + next(g); },
  arrayFrom() { const box = new Box(counts(4)); return lists(box.get()) + ' ' + lists(box.get()); },
  handedIn(flag) { const g = steps(4); const run = data => walk(id(data)) + ' ' + next(id(data)); return run(g) + ' ' + next(g); },
  inLoop() { const box = new Box(counts(8)); let n = 0; for (let i = 0; i < 3; i++) n = n * 10 + walk(box.get()); return n + ' ' + spread(box.get()); },
  inLoopMade() { let n = 0; const box = new Box(null); for (let i = 0; i < 3; i++) { box.g ??= counts(8); n = n * 10 + walk(box.get()); } return n; },
  wrapped() { return all(id(counts(4))) + ' ' + walk(id(steps(4))); },
  ternary(flag) { const g = steps(4); return walk(flag ? id(g) : g) + ' ' + next(g); },
  made() { return walk(steps(4)) + ' ' + walk(steps(4)) + ' ' + all(steps(4)); },
  madeBehind() { const make = () => counts(4); return all(make()) + ' ' + walk(make()) + ' ' + spread(make()); },
  madeInLoop() { let n = 0; for (let i = 0; i < 5; i++) n += all(counts(i)) + walk(steps(i)); return n; },
  array() { const map = new Map([['k', [1, 2, 3]]]); map.get('k').push(4); return map.get('k').length + ' ' + (map.get('k') === map.get('k')); },
  object() { const map = new Map([['k', { n: 1 }]]); map.get('k').n++; return map.get('k').n + ' ' + (map.get('k') === map.get('k')); },
  instance() { const map = new Map([['k', new Box(1)]]); map.get('k').g = 7; return map.get('k').get() + ' ' + (map.get('k') === map.get('k')); },
  fn() { const map = new Map([['k', function () { return 1; }]]); map.get('k').x = 3; return map.get('k').x + ' ' + (map.get('k') === map.get('k')); },
  arrayIterator() { const map = new Map([['k', [1, 2, 3].values()]]); return walk(map.get('k')) + ' ' + next(map.get('k')); },
  mapIterator() { const map = new Map([['k', new Set([1, 2, 3]).values()]]); return walk(map.get('k')) + ' ' + next(map.get('k')); },
  date() { const map = new Map([['k', new Date(0)]]); map.get('k').setTime(5); return map.get('k').getTime(); },
  regexp() { const map = new Map([['k', /a/g]]); map.get('k').lastIndex = 2; return map.get('k').lastIndex; },
};
for (let round = 0; round < 3; round++) for (const [name, run] of Object.entries(forms)) say(name, () => run(round > 0));
console.log(says.join('\n'));
const direct = [forms.mapLiteral(), forms.mapSet(), forms.identity(), forms.box(), forms.closure(), forms.kept(), forms.once(), forms.at()];
console.log(direct.join('\n'));
