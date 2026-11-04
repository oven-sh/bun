const above = { set member(value) { console.log("the setter ran"); } };
const made = { __proto__: above, member: "the property" };
console.log(made.member, Object.hasOwn(made, "member"));
