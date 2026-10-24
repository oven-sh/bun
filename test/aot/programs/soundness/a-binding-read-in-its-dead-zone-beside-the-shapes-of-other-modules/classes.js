// More of them, in a module without types.
class Point { constructor() { this.x = 1; this.y = 2; } }
class Box { constructor() { this.x = 3; this.width = 4; } }
console.log("classes", new Point().x + new Box().x);
