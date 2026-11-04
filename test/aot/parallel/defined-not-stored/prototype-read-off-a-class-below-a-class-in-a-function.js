class Above { member() { return "above"; } }
class Below extends Above { member() { return "below"; } }
function prototypeOf(klass) { return klass.prototype; }
console.log(prototypeOf(Below).member(), prototypeOf(Above).member(), prototypeOf(Below) === Below.prototype);
