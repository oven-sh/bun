class Above { static get member() { return "above"; } }
Object.freeze(Above);
class Below extends Above { static get member() { return "below"; } }
console.log(Below.member, Above.member);
