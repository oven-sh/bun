class Above { get member() { return "the getter"; } }
class Below extends Above { member = "the field"; }
const made = new Below();
console.log(made.member, Object.hasOwn(made, "member"));
