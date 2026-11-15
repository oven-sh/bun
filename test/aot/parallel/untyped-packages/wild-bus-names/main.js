// An untyped package and a program of it (names): an event bus with name spaces, wild cards, once, removal while emitting, error events and answers
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const b = new lib(), log = []; const rec = t => function (...a) { log.push(t + ':' + a.join('/') + (this === b ? '' : '@' + this.id)); };
b.on('user.login', rec('a')).on('user.*', rec('b')).on('**', rec('c')).on('user.**', rec('d')).once('user.login', rec('once')).prepend('user.login', rec('pre')).on('*.login', rec('e'), { id: 7 });
['user.login', 'user.login', 'user', 'user.x.y', 'admin.login', 'other', 'user.logout', 'a.b.c.d', 'user.*'].forEach((n, i) => { log.length = 0; say(n, b.emit(n, i, 'x' + i), b.count(n), log.join(' ')); });
try { b.emit('error', 'lost'); } catch (e) { say(e.message); } const lone = new lib(); try { lone.emit('error', new RangeError('r')); } catch (e) { say(e.name); } try { lone.emit('error', 5); } catch (e) { say(e.message); } try { lone.on('x', 5); } catch (e) { say(e.message); } say(lone.emit('x'));
