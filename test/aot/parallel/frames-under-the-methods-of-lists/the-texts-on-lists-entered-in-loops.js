// A built-in handed to a method of a list in a loop: the text of the method for a receiver known for a list is entered: its frame bears the method's name (it said `mapOfList`).
const frames = e => String(e.stack).split('\n').slice(1).map(l => { const m = /^\s*at (?:async )?([^\s(]+) \(/.exec(l); return m ? m[1] : '<anonymous>'; }).slice(0, 4).join(' < ');
const tell = (name, made) => console.log(name, made());
tell('map', () => { let s = ''; for (let i = 0; i < 3; i++) [{ valueOf() { s = frames(new Error('x')); return i; } }, '4', 5].map(Number); return s; });
tell('filter', () => { let s = ''; for (let i = 0; i < 3; i++) [{ valueOf() { s = frames(new Error('x')); return i; } }, '4', 5].filter(Number); return s; });
tell('forEach', () => { let s = ''; for (let i = 0; i < 3; i++) [{ valueOf() { s = frames(new Error('x')); return i; } }, '4', 5].forEach(Number); return s; });
tell('some', () => { let s = ''; for (let i = 0; i < 3; i++) [{ valueOf() { s = frames(new Error('x')); return 0; } }, '4', 5].some(Number); return s; });
tell('every', () => { let s = ''; for (let i = 0; i < 3; i++) [{ valueOf() { s = frames(new Error('x')); return 1; } }, '4', 5].every(Number); return s; });
tell('find', () => { let s = ''; for (let i = 0; i < 3; i++) [{ valueOf() { s = frames(new Error('x')); return 0; } }, '4', 5].find(Number); return s; });
tell('findIndex', () => { let s = ''; for (let i = 0; i < 3; i++) [{ valueOf() { s = frames(new Error('x')); return 0; } }, '4', 5].findIndex(Number); return s; });
tell('reduce', () => { let s = ''; for (let i = 0; i < 3; i++) [{ valueOf() { s = frames(new Error('x')); return 0; } }, '4', 5].reduce(Math.max); return s; });
tell('map throws', () => { let s = ''; for (let i = 0; i < 3; i++) { try { ['1', Symbol('s')].map(Number); } catch (e) { s = e.name + ' ' + frames(e); } } return s; });
tell('filter throws', () => { let s = ''; for (let i = 0; i < 3; i++) { try { ['1', Symbol('s')].filter(Number); } catch (e) { s = e.name + ' ' + frames(e); } } return s; });
tell('some throws', () => { let s = ''; for (let i = 0; i < 3; i++) { try { ['0', Symbol('s')].some(Number); } catch (e) { s = e.name + ' ' + frames(e); } } return s; });
tell('every throws', () => { let s = ''; for (let i = 0; i < 3; i++) { try { ['1', Symbol('s')].every(Number); } catch (e) { s = e.name + ' ' + frames(e); } } return s; });
tell('find throws', () => { let s = ''; for (let i = 0; i < 3; i++) { try { ['0', Symbol('s')].find(Number); } catch (e) { s = e.name + ' ' + frames(e); } } return s; });
tell('findIndex throws', () => { let s = ''; for (let i = 0; i < 3; i++) { try { ['0', Symbol('s')].findIndex(Number); } catch (e) { s = e.name + ' ' + frames(e); } } return s; });
tell('forEach throws', () => { let s = ''; for (let i = 0; i < 3; i++) { try { ['1', Symbol('s')].forEach(Number); } catch (e) { s = e.name + ' ' + frames(e); } } return s; });
function named(x) { if (x === 2) throw new Error('two'); return x; }
const outside = JSON.parse('[1,2,3]');
for (const name of ['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex']) tell(name + ' named', () => { let s = ''; for (let i = 0; i < 3; i++) { try { outside[name](named); } catch (e) { s = frames(e); } } return s; });
tell('the names', () => [Array.prototype.map.name, Array.prototype.filter.name, Array.prototype.some.name, Array.prototype.reduce.name, Array.prototype.find.name].join());
