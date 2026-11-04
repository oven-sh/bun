const l = [1];
function act() { Object.defineProperty(l, "length", { writable: false }); }
act();
try { l.push(2); console.log("pushed"); } catch (e) { console.log(e.constructor.name); }
console.log(l.length);
