const key = Symbol("member");
const above = { set [key](value) { console.log("the setter ran"); } };
const made = { __proto__: above, [key]: "the property" };
console.log(made[key], Object.hasOwn(made, key));
