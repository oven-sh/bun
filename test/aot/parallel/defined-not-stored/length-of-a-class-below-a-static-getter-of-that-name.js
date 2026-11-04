class Above { static get length() { return "from the getter"; } }
class Below extends Above { constructor(first, second, third) { super(); } }
console.log(Below.length, Above.length);
