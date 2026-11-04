class Above { get member() { return "the getter above"; } }
class Below extends Above { set member(value) { console.log("the setter ran with", value); } }
const made = new Below();
console.log(made.member);
made.member = 1;
console.log(made.member);
