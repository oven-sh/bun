class List<T> {
  items: T[] = [];
}
declare module "shapes" {
  class Square {
    side: number;
  }
}
declare module "drawings" {
  import shapes = require("shapes");
  export var squares: List<shapes.Square>;
}
console.log("SAID", new List<number>().items.length);
