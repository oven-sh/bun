// The class between defines its field on an older object that the base constructor answers.
class Vector {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
const shared = new Vector(4, 5);
class Back {
  constructor() {
    return shared;
  }
}
class Middle extends Back {
  x = 77;
}
class Heir extends Middle {
  z = 1;
}
function construct() {
  return new Heir();
}
function read(vector) {
  let text = "";
  for (let i = 0; i < 3; i++) {
    text += vector.x + ",";
    construct();
  }
  return text + vector.x;
}
console.log(read(shared), shared.z);
