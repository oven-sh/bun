class Above { static get name() { return "from the getter"; } static who() { return this.name; } }
class Below extends Above {}
console.log(Below.who(), Above.who());
