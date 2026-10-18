class Plain {
  size = 1;
}

function named<Base extends new (...args: any[]) => object>(base: Base) {
  return class extends base {
    name = "box";
  };
}

class Box extends named(Plain) {
  width = 2;
}

const box = new Box();
console.log(box.width + box.size, box.name);
