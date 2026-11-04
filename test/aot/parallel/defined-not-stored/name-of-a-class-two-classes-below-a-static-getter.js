class Above { static get name() { return "from the getter"; } }
class Between extends Above {}
class Below extends Between {}
console.log(Below.name, Between.name, Above.name);
