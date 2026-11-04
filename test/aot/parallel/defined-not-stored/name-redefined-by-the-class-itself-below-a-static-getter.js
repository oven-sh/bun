class Above { static get name() { return "above"; } }
class Below extends Above { static get name() { return "below, and " + super.name; } }
class Lowest extends Below {}
console.log(Below.name, Lowest.name);
