class Above { static get ["name"]() { return "from the getter"; } static get ["length"]() { return "from the other getter"; } }
class Below extends Above { constructor(first, second) { super(); } }
console.log(Below.name, Below.length, Above.name, Above.length);
