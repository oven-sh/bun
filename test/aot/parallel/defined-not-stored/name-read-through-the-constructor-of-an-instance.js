class Above { static get name() { return "from the getter"; } }
class Below extends Above {}
console.log(new Below().constructor.name, new Above().constructor.name);
