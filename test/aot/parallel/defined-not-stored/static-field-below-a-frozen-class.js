class Above { static member = "above"; }
Object.freeze(Above);
class Below extends Above { static member = "below"; }
console.log(Below.member, Above.member);
