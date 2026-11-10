function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
let log = '';
function say(x) { log += x; return x; }
function make() { return { z: say('z'), 2: say('two'), a: say('a'), 1: say('one'), m() { return 1; }, b: say('b') }; }
console.log(show(make()), log);
