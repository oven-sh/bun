class Point {
  x = 1;
}
class Other {
  a = "a";
}
class Child extends Point {
  z = 3;
}

console.log("declared parent:", Object.keys(new Child()).join());
Object.setPrototypeOf(Child, Other);
const made = new Child();
console.log("another parent:", Object.keys(made).join(), made.a, made.z);
Object.setPrototypeOf(Child, Point);
console.log("declared parent again:", Object.keys(new Child()).join());
