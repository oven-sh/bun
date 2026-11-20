// Names that are stored once are expected to hold what the text of their file makes, records too; records of other files bear the same member names. What lies there is looked at wherever it counts: it is changed, replaced, taken away, frozen and handed about here.
'use strict';
const { hang, take, look, shelve, turn, pegs } = require('./pegs.cjs');
const other = { now: 'other', worn: 5 }, list = [{ now: 1 }, { now: 'a', more: 2 }, { worn: 3, now: 4 }], seen = [];
function nows(all) { let out = ''; for (const each of all) out += each.now + (each.worn === undefined ? '' : '/' + each.worn) + ' '; return out; }
for (let k = 0; k < 80; k++) { hang('c' + k, k); look(); shelve(k); turn(4); take(); nows(list); nows([pegs.coats, other, pegs.hats]); }
console.log(look(), take(), nows(list), nows([pegs.coats, pegs.hats, other]), turn(3));
hang('red', 1); hang('blue', 2.5); hang({ toString: () => 'own' }, null); console.log(look(), String(take()), take(), look());
pegs.coats.now = 7; pegs.hats.now = [1, 2]; console.log(look(), take(), look(), take(), take());
pegs.coats.more = 'late'; delete pegs.hats.worn; pegs.shelf.box = other; console.log(shelve('thing'), look(), other.now, Object.keys(pegs.coats).join(), Object.keys(pegs.hats).join());
Object.defineProperty(pegs.coats, 'now', { get() { seen.push('get'); return 'got'; }, set(v) { seen.push('set ' + v); }, configurable: true }); hang('x', 'y'); console.log(look(), take(), seen.join());
delete pegs.coats.now; console.log(look()); Object.setPrototypeOf(pegs.coats, { now: 'above' }); console.log(look()); hang('z', 1); console.log(look(), Object.hasOwn(pegs.coats, 'now'), take());
Object.freeze(pegs.coats); try { hang('cold', 3); console.log('no'); } catch (error) { console.log(error.constructor.name, look()); } try { console.log(take(), look()); } catch (error) { console.log(error.constructor.name); }
pegs.keys[0] = other; other.now = 10n; try { console.log(turn(1)); } catch (error) { console.log(error.constructor.name); } pegs.keys[0] = { now: '1' }; console.log(turn(4), pegs.keys[0].now); pegs.keys.length = 1; console.log(turn(1)); try { console.log(turn(2)); } catch (error) { console.log(error.constructor.name); }
pegs.rail.below = { '-1': 'under' }; pegs.rail.now = '4'; console.log(look()); pegs.shelf.box = null; try { shelve(1); } catch (error) { console.log(error.constructor.name, pegs.shelf.now); }
