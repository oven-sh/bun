class Above { static name() { return "called"; } }
class Below extends Above {}
console.log(Below.name, Above.name());
