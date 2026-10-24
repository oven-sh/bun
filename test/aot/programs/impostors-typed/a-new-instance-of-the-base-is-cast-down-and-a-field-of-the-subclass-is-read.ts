class Shape {
  sides = 4;
}
class Square extends Shape {
  edge = 2;
}
const s = new Shape();
console.log((s as Square).edge * 2);
