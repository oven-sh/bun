class Point { constructor() { this.x = 1; } }
const above = new Proxy({ far: "found" }, { getPrototypeOf() { return { never: true }; } });
const point = new Point();
Object.setPrototypeOf(Point.prototype, above);
console.log(point.x, point.far, point.never, "far" in point, "never" in point);
