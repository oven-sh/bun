class Above { set member(value) { console.log("the setter ran"); } }
class Below extends Above { member = "the field"; }
const made = new Below();
console.log(made.member, Object.hasOwn(made, "member"));
