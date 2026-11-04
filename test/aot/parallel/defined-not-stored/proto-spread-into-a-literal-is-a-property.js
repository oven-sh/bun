const above = { member: "above" };
const source = { ["__proto__"]: above };
const made = { ...source };
console.log(Object.getPrototypeOf(made) === Object.prototype, Object.hasOwn(made, "__proto__"), made.member);
