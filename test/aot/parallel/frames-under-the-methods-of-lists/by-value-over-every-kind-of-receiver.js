// A function handed to a method of lists throws: the stack lists the method under its own name, whatever the receiver holds: whole numbers, fractions, objects, holes, a mix, an array-like.
// some, every, find, findIndex and reduce left by a tail call of a hidden helper where the run over a plain vector ends: no frame of the method was listed.
const frames = e => String(e.stack).split('\n').slice(1).map(l => { const m = /^\s*at (?:async )?([^\s(]+) \(/.exec(l); return m ? m[1] : '<anonymous>'; }).slice(0, 4).join(' < ');
function thrower() { throw new Error('thrown'); }
const lists = { whole: [1, 2, 3], fractions: [1.5, 2.5, 3.5], objects: [{}, {}, {}], holes: [1, , 3], mixed: [1, 'a', {}], like: { length: 2, 0: 1, 1: 2 } };
const unknown = JSON.parse('[1,2,3]');
for (const name of ['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'reduce']) {
  for (const kind of Object.keys(lists)) {
    const list = lists[kind];
    for (const [how, call] of [
      ['named', () => Array.prototype[name].call(list, thrower, 0)],
      ['arrow', () => Array.prototype[name].call(list, () => { throw new Error('thrown'); }, 0)],
    ]) {
      try { call(); console.log(name, kind, how, 'no throw'); } catch (e) { console.log(name, kind, how, frames(e)); }
    }
  }
}
function direct() {
  const out = [];
  const tries = [
    () => unknown.map(thrower), () => unknown.filter(thrower), () => unknown.forEach(thrower), () => unknown.some(thrower), () => unknown.every(thrower), () => unknown.find(thrower), () => unknown.findIndex(thrower), () => unknown.reduce(thrower, 0),
    () => [1, 2, 3].map(thrower), () => [1.5, 2.5].map(thrower), () => [1, 2, 3].filter(thrower), () => [1, 2, 3].reduce(thrower, 0), () => [1, 2, 3].map(Number.prototype.toFixed.call.bind(Symbol.prototype.toString)),
    () => [Symbol()].map(Number), () => [Symbol()].map(String.prototype.trim.call.bind(String.prototype.trim)), () => [Symbol()].filter(Number), () => [Symbol()].some(Number), () => [Symbol()].forEach(Number),
  ];
  for (let i = 0; i < tries.length; i++) { try { tries[i](); out.push(i + ' no throw'); } catch (e) { out.push(i + ' ' + frames(e)); } }
  return out;
}
for (const line of direct()) console.log('direct', line);
function looped(n) { let said = ''; for (let i = 0; i < n; i++) { try { unknown.map(thrower); } catch (e) { said = frames(e); } try { unknown.filter(x => { if (x === 2) throw new Error('two'); return true; }); } catch (e) { said += ' | ' + frames(e); } } return said; }
console.log('looped', looped(3));
