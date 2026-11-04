class Above { static set member(value) { console.log("the setter ran"); } }
class Below extends Above { static member = "the field"; }
console.log(Below.member, Object.hasOwn(Below, "member"), Above.member);
