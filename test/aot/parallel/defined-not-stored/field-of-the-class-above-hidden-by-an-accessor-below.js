class Above { member = "the field"; }
class Below extends Above { set member(value) { console.log("the setter ran"); } get member() { return "the getter"; } }
const made = new Below();
console.log(made.member, Object.hasOwn(made, "member"));
