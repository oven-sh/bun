// A `var` that nothing assigns again is undefined until its declaration has run. The body that declares it is a generator: whoever steps it between two reads finds both.
let leaked;
function* owner() { leaked = () => x; yield 0; var x = 1; yield 1; }
function both() { const it = owner(); it.next(); const read = leaked; const a = read(); it.next(); const b = read(); return a + ":" + b; }
console.log(both(), both());

function* ownerOfFunction() { leakedCall = () => typeof late + ":" + typeof early; function early() {} yield 0; var late = function () {}; yield 1; }
let leakedCall;
function bothKinds() { const it = ownerOfFunction(); it.next(); const read = leakedCall; const a = read(); it.next(); return a + "|" + read(); }
console.log(bothKinds());

function* ownerWithDeadZone() { leakedLater = () => { try { return fixed; } catch (error) { return error.name; } }; yield 0; const fixed = 5; yield 1; }
let leakedLater;
function bothZones() { const it = ownerWithDeadZone(); it.next(); const read = leakedLater; const a = read(); it.next(); return a + "|" + read() + "|" + read(); }
console.log(bothZones());
