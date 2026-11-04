class Above { static set member(value) { console.log("the setter ran"); } }
class Below extends Above { static member() { return "the method"; } }
console.log(Below.member(), Object.hasOwn(Below, "member"));
