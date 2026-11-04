const above = { set 0(value) { console.log("the setter ran"); } };
const made = { __proto__: above, 0: "the property" };
console.log(made[0], Object.hasOwn(made, "0"));
