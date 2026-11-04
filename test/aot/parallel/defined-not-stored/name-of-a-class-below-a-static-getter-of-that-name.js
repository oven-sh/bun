class Above { static get name() { return "from the getter"; } }
class Below extends Above {}
console.log(Below.name, Above.name);
