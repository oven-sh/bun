class Plain {
  size = 1;
}

class Named extends Plain {
  name = "box";
}

class Box extends Named {
  width = 2;
}

const box = new Box();
console.log(box.width + box.size, box.name);
