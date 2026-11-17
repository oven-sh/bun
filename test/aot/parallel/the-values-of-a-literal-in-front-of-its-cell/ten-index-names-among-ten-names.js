const log = [];
function say(x) { log.push(x); return x; }
function show(o) { return Object.keys(o).join() + "|" + JSON.stringify(o); }
function make() { return { n0: say(1) | 0, 9: say(2) | 0, n1: say(3) | 0, 8: say(4) | 0, n2: say(5) | 0, 7: say(6) | 0, n3: say(7) | 0, 6: say(8) | 0, n4: say(9) | 0, 5: say(10) | 0, n5: say(11) | 0, 4: say(12) | 0, n6: say(13) | 0, 3: say(14) | 0, n7: say(15) | 0, 2: say(16) | 0, n8: say(17) | 0, 1: say(18) | 0, n9: say(19) | 0, 0: say(20) | 0 }; }
console.log("SAID", show(make()), log.join());
