class Above {}
Object.freeze(Above.prototype);
class Below extends Above {}
console.log(new Below().constructor === Below, Object.hasOwn(Below.prototype, "constructor"));
