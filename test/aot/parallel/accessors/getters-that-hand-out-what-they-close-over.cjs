// STATISTIC: FunctionsReturningCaptures >= 4
// A getter that only hands out a variable that it closes over, or what a record or a list that it closes over holds under a name that it closes over: each read answers as the variable stands by then.
'use strict';
function weather(town) {
  let degrees = 11, wind, sky = 'dry', hour = 1;
  let words = { dry: 'sun on ' + town, wet: 'rain on ' + town };
  const hours = [6, 9, 12], face = {
    warm(by) { degrees += by; }, blow(v) { wind = v; }, turn(to) { sky = to; }, pass(n) { hour += n; }, fill(v) { hours.push(v); }, say(o) { words = o; },
  };
  Object.defineProperty(face, 'degrees', { enumerable: true, configurable: true, get: function () { return degrees; } });
  Object.defineProperty(face, 'wind', { configurable: true, get: () => wind });
  Object.defineProperty(face, 'sky', { enumerable: true, configurable: true, get() { return words[sky]; } });
  Object.defineProperty(face, 'hour', { configurable: true, get: () => hours[hour] });
  return face;
}
function total(list, turns) { let sum = 0, said = ''; for (let i = 0; i < turns; i++) { const w = list[i % list.length]; sum += w.degrees; said += w.sky + (w.hour === undefined ? '-' : w.hour) + w.wind; if (i % 5 === 4) w.warm(i / 2); } return sum + said.length; }
function named(o, name) { return o[name]; }
const towns = ['Ash', 'Birch', 'Cedar'].map(weather), tell = x => { try { return String(x()); } catch (error) { return error.constructor.name; } };
for (let k = 0; k < 60; k++) total(towns, 12);
console.log(total(towns, 9), towns.map(t => t.degrees).join(), Object.keys(towns[0]).join(), JSON.stringify(towns[1]));
towns[0].blow(-0); towns[1].blow(null); towns[2].blow({ toString() { return 'gale'; } });
console.log(Object.is(towns[0].wind, -0), towns[1].wind, '' + towns[2].wind, total(towns, 6));
for (const [t, to] of [[0, 'wet'], [1, 'fog'], [2, 'toString']]) { towns[t].turn(to); console.log(t, typeof towns[t].sky, t < 2 ? towns[t].sky : '', named(towns[t], 'hour'), named(towns[t], ['sk', 'y'].join('')) === towns[t].sky); }
towns[0].pass(1); towns[1].pass(7); towns[2].pass(-9); console.log(towns.map(t => t.hour).join('|')); towns[1].fill('late'); for (let n = 3; n < 8; n++) towns[1].fill(n * n); console.log(towns[1].hour); towns[0].pass(0.5); console.log(towns[0].hour);
const below = Object.create(towns[0]), kept = { ...towns[1] }, { degrees: taken, sky: seen = 'none', wind: blown } = towns[2];
towns[0].warm(0.25); towns[1].warm(1e9);
console.log(below.degrees === towns[0].degrees, Reflect.get(towns[0], 'degrees', 5), kept.degrees === towns[1].degrees, typeof seen, taken === towns[2].degrees, '' + blown, Object.assign({}, towns[1]).degrees);
for (const given of [null, undefined, 'text', new Proxy({}, { get: (o, k) => 'for ' + String(k) }), [4, 5]]) { towns[0].say(given); console.log(tell(() => towns[0].sky), tell(() => below.sky)); }
console.log(tell(() => { towns[0].degrees = 3; }), tell(() => { below.hour = 3; }), tell(() => Object.getOwnPropertyDescriptor(towns[0], 'hour').get()), tell(() => new (Object.getOwnPropertyDescriptor(towns[0], 'wind').get)()));
function early() { const o = {}; Object.defineProperty(o, 'later', { get: () => later }); const first = tell(() => o.later); let later = 'now'; return first + ' ' + tell(() => o.later); }
function each(n) { const all = []; for (let i = 0; i < n; i++) all.push(Object.defineProperty({}, 'at', { get: () => i, set(v) { i += v; } })); for (const o of all) o.at = 10; return all.map(o => o.at).join(); }
console.log(early(), early(), each(4));
const mark = Symbol('mark'), table = { [mark]: 1, deep: { x: 2 } }; let under = mark; const symbol = Object.defineProperty({}, 'held', { get: () => table[under] }); const was = symbol.held; under = 'deep'; console.log(was, symbol.held.x); under = { toString() { return 'deep'; } }; console.log(symbol.held === table.deep); under = -1; console.log(symbol.held);
Object.defineProperty(towns[2], 'degrees', { get: () => 'other' }); console.log(towns[2].degrees, total(towns, 4)); Object.defineProperty(towns[1], 'degrees', { value: 7, writable: true }); towns[1].degrees++; console.log(towns[1].degrees, total(towns, 4)); delete towns[0].hour; console.log(towns[0].hour, below.hour, total(towns, 3)); Object.freeze(towns[2]); towns[2].turn('wet'); console.log(towns[2].sky);
class Booth { #seats = 4; static open = 0; constructor(n) { let left = n; Object.defineProperty(this, 'left', { get: () => left }); this.sell = k => { left -= k; return this; }; } get seats() { return this.#seats; } }
const booths = [new Booth(3), new Booth(10n), new Booth('8')]; function leftOf(n) { let out = ''; for (let i = 0; i < n; i++) out += booths[i % 3].left + ';'; return out; }
for (let k = 0; k < 40; k++) leftOf(6); booths[0].sell(1); booths[1].sell(2n); booths[2].sell(0.5); console.log(leftOf(3), tell(() => booths[1].sell(1)), booths[0].seats, Object.keys(booths[0]).join());
