class Above { static set name(value) { console.log("the setter ran"); } }
class Below extends Above {}
const Unnamed = class extends Above {};
console.log(Below.name, Unnamed.name, Above.name, Object.hasOwn(Below, "name"));
