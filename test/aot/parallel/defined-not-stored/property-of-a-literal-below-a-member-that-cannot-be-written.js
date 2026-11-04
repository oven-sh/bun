const above = Object.freeze({ member: "above" });
const made = { __proto__: above, member: "the property" };
console.log(made.member, Object.hasOwn(made, "member"));
