class Above { set member(value) { console.log("the setter ran"); } }
class Below extends Above { member() { return "the method"; } }
console.log(new Below().member(), Object.hasOwn(Below.prototype, "member"));
