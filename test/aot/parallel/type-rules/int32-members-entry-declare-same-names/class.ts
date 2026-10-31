class Point { x = 0.5; y = 1.5; }
class Pixel { x = 2.5; y = 3.5; }
const like: Point = { x: 4.5, y: 5.5 };
console.log(new Point().x + new Pixel().y + like.x);
export {};
