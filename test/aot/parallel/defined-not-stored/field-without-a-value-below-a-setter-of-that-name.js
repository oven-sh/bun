class Above { set member(value) { console.log("the setter ran"); } get member() { return "the getter"; } }
class Below extends Above { member; }
const made = new Below();
console.log(made.member, Object.hasOwn(made, "member"));
