class Above { member() { return "above"; } }
Object.freeze(Above.prototype);
class Below extends Above { member() { return "below"; } }
console.log(new Below().member(), new Above().member());
