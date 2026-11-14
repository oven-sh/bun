// An untyped package and a program of it (answers): an event bus with name spaces, wild cards, once, removal while emitting, error events and answers
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const b = new lib(); b.on('sum', (x, y) => x + y); b.on('sum', function (x, y) { return this.k * x * y; }, { k: 2 }); b.on('*', x => typeof x); const list = [1, 2.5, 'a', 10n, null, [1], NaN, -0, true]; for (let i = 0; i < 20; i++) { let r; try { r = b.ask('sum', list[i % 9], list[(i * 4) % 9]); } catch (e) { r = [e.constructor.name]; } say(i, r.map(String).join(' '), r.length, b.ask('none' + i).join()); if (i === 11) b.once('sum', () => 'third'); }
