const base = { get area() { return 7; } };
class Shape { constructor() { Object.setPrototypeOf(this, base); } }
console.log(JSON.stringify(new Shape(), ["area"]));
