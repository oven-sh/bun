function Meter() { this.n = 1; }
Meter.prototype = null;
let how = "laid"; try { Meter.prototype.show = function () { return 1; }; } catch (e) { how = e.constructor.name; }
let call; try { call = new Meter().show(); } catch (e) { call = e.constructor.name; }
console.log(how, call);
