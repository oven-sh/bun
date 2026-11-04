const above = { set member(value) { console.log("the setter ran"); } };
const source = { member: "the property" };
const made = { __proto__: above, ...source };
console.log(made.member, Object.hasOwn(made, "member"));
