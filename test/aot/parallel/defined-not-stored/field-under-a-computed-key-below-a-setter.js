const key = ["mem", "ber"].join("");
class Above { set member(value) { console.log("the setter ran"); } }
class Below extends Above { [key] = "the field"; }
const made = new Below();
console.log(made.member, Object.hasOwn(made, "member"));
