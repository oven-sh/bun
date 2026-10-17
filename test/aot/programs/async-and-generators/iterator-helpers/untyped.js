export function untyped(make) {
  function mapped(it) { return it.map(x => x + 1).toArray(); }
  function filtered(it) { return it.filter(x => x > 1).toArray(); }
  function flattened(it) { return it.flatMap(x => [x, x]).toArray(); }
  function rest(it) { return [it().take(2).toArray(), it().drop(1).toArray(), it().reduce((sum, x) => sum + x, 0), it().some(x => x > 1), it().every(x => x > 1), it().find(x => x > 1)]; }
  return [mapped(make()), filtered(make()), flattened(make()), rest(make), [...make().map(x => x * 2)]];
}
