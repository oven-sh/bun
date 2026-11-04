const above = { set member(value) { console.log("the setter above ran"); } };
const made = { __proto__: above, get member() { return "the getter"; } };
console.log(made.member);
try { made.member = 1; console.log("stored"); } catch (error) { console.log(error.constructor.name); }
