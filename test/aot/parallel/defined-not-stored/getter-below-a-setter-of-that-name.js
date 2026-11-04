class Above { set member(value) { console.log("the setter above ran"); } }
class Below extends Above { get member() { return "the getter"; } }
const made = new Below();
console.log(made.member);
try { made.member = 1; console.log("stored"); } catch (error) { console.log(error.constructor.name); }
console.log(made.member, Object.hasOwn(made, "member"));
