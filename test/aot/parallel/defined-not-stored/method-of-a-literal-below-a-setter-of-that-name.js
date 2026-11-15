const above = { set member(value) { console.log("the setter ran"); } };
const made = { __proto__: above, member() { return "the method"; } };
console.log(made.member(), Object.hasOwn(made, "member"));
