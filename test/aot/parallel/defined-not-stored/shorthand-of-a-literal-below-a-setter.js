const above = { set member(value) { console.log("the setter ran"); } };
const member = "the property";
const made = { __proto__: above, member };
console.log(made.member, Object.hasOwn(made, "member"));
