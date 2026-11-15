function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
let log = '';
function say(x) { log += x; if (x === 'b') throw new Error('stop'); return x; }
function make() { return { a: say('a'), b: say('b'), c: say('c') }; }
try { make(); } catch (e) { log += '!' + e.message; }
console.log(log);
