// A store through a proxy without traps onto a list below a typed array: the typed array takes an index that is not there, and an element that is there is stored into.
function lists() { return [[1, , 3], [1, 2, 3], [], [0.5, , 2.5], new Array(4)]; }
function parents() { return [new Uint8Array(1), new Float64Array(4), Object.create(new Int32Array(2)), Array.prototype, null]; }
const ways = {
  index(t) { t[1] = 5; },
  key(t) { for (const k of [0, 1, 2]) t[k] = k + 10; },
  beyond(t) { t[6] = 5; },
  reflect(t) { return Reflect.set(t, 1, 6); },
  push(t) { return Array.prototype.push.call(t, 7); },
  fill(t) { Array.prototype.fill.call(t, 9); },
  assign(t) { Object.assign(t, { 1: 5, b: 2 }); },
  named(t) { t.b = 3; t['1.5'] = 4; },
};
for (const name in ways) {
  for (const parent of parents()) {
    const line = [];
    for (const list of lists()) {
      if (parent !== Array.prototype) Object.setPrototypeOf(list, parent);
      const proxy = new Proxy(list, {});
      let answer;
      try { answer = ways[name](proxy); } catch (error) { answer = error.name; }
      line.push(Object.getOwnPropertyNames(list).map(key => key + ':' + list[key]).join() + ' ' + answer);
    }
    console.log(name, line.join(' | '));
  }
}
