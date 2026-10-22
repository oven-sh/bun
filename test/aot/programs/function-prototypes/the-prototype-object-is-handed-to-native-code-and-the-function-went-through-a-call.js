// Native code lists, copies, prints and freezes the prototype object of a plain function. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const Meter = hide(function Meter() {});
Meter.prototype.size = 3;
Meter.prototype.read = function () { return this.size; };
let thrown = "nothing";
try { structuredClone(Meter.prototype); } catch (error) { thrown = error.name; }
console.log(Object.keys(Meter.prototype).join(), JSON.stringify(Meter.prototype), Object.entries(Meter.prototype).length, typeof Object.assign({}, Meter.prototype).read, thrown);
console.log(Meter.prototype, new Meter());
Object.freeze(Meter.prototype);
const refused = [];
try { Meter.prototype.size = "wide"; } catch (error) { refused.push(error.constructor.name); }
try { Meter.prototype.more = 1; } catch (error) { refused.push(error.constructor.name); }
console.log(new Meter().read(), "more" in Meter.prototype, Object.isFrozen(Meter.prototype), refused.join());
