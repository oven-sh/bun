// An untyped package and a program of it (while emitting): an event bus with name spaces, wild cards, once, removal while emitting, error events and answers
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const b = new lib({ sep: ':', max: 3 }), log = []; function self() { log.push('self'); b.off('t:x', self); } function add() { log.push('add'); if (log.length < 8) b.on('t:x', () => { log.push('added'); }); } let stop = false;
b.on('newListener', n => log.push('new ' + n)); b.on('t:x', self).on('t:x', add).on('t:x', () => { log.push('mid'); return stop ? lib.STOP : undefined; }).on('t:*', () => { log.push('star'); throw new Error('thrown ' + log.length); });
for (let i = 0; i < 12; i++) { if (i === 6) stop = true; if (i === 9) b.off('t:*'); if (i === 10) b.off('t:x'); let r; try { r = b.emit('t:x', i); } catch (e) { r = e.message; } say(i, r, log.splice(0).join(' '), b.count('t:x'), b.warned.join()); }
