const above = { member: "above" };
const made = { __proto__: above };
console.log(Object.getPrototypeOf(made) === above, Object.hasOwn(made, "__proto__"), made.member);
const quoted = { "__proto__": above };
console.log(Object.getPrototypeOf(quoted) === above, Object.hasOwn(quoted, "__proto__"));
