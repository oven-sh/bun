function Shape() {}
Shape.prototype.sides = 3;
Shape.prototype.name = "triangle";
const one = new Shape();
const read = shape => shape.sides + " " + shape.name;
console.log(read(one), read(one));
for (const key in Shape.prototype) Shape.prototype[key] = key === "sides" ? 4 : "square";
console.log(read(one), read(new Shape()));
