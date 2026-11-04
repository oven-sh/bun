const above = { member: "above" };
const made = { ["__proto__"]: above };
console.log(Object.getPrototypeOf(made) === Object.prototype, Object.hasOwn(made, "__proto__"), made.member);
const key = ["__pro", "to__"].join("");
const worked = { [key]: above };
console.log(Object.getPrototypeOf(worked) === Object.prototype, Object.hasOwn(worked, "__proto__"), worked.member);
