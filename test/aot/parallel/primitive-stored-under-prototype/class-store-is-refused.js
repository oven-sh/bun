class Dial { constructor() { this.n = 1; } }
let how = "stored"; try { Dial.prototype = null; } catch (e) { how = e.constructor.name; }
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
console.log(how, tell(Dial.prototype), typeof Dial.prototype);
