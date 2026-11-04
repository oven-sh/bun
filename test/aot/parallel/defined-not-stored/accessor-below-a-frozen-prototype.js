class Above { get member() { return "above"; } }
Object.freeze(Above.prototype);
class Below extends Above { get member() { return "below"; } }
console.log(new Below().member, new Above().member);
