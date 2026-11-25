class Above { constructor(v) { this.v = v; } who() { return "above" + this.v; } static make(v) { return new this(v); } get g() { return "g" + this.v; } }
class Below extends Above { constructor(v) { super(v + 1); } who() { return "below>" + super.who(); } static make(v) { return super.make(v * 2); } get g() { return "b" + super.g; } }
const made = Below.make(2);
console.log(made.who(), made.g, made instanceof Below, made instanceof Above, made.constructor === Below);
Object.setPrototypeOf(Below.prototype, { who() { return "swapped"; }, get g() { return "sg"; } });
console.log(made.who(), made.g, made instanceof Above);
