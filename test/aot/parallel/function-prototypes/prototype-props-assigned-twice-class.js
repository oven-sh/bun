// The class is linked to the first object. The test looks at the second, which the function has by then.
function Meter() {}
Meter.prototype = { read() { return "first"; } };
class Fine extends Meter {}
Meter.prototype = { read() { return "second"; } };
console.log(new Meter().read(), new Fine() instanceof Meter);
