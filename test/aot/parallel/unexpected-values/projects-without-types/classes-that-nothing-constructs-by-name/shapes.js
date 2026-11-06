export class Shape {
  sides = 0;
  name = "shape";
  area() {
    return 0;
  }
  describe() {
    return this.name + " " + this.sides + " " + this.area();
  }
}
export class Square extends Shape {
  sides = 4;
  name = "square";
  constructor(side = 2) {
    super();
    this.side = side;
  }
  area() {
    return this.side * this.side;
  }
}
export class ByReflect extends Shape {
  sides = 5;
  name = "ByReflect";
  extra = "ByReflect has a field of its own";
  area() {
    return "the area of ByReflect";
  }
}
export class ByATable extends Shape {
  sides = 6;
  name = "ByATable";
  extra = "ByATable has a field of its own";
  area() {
    return "the area of ByATable";
  }
}
export class Bound extends Shape {
  sides = 7;
  name = "Bound";
  extra = "Bound has a field of its own";
  area() {
    return "the area of Bound";
  }
}
export class ByItsInstance extends Shape {
  sides = 8;
  name = "ByItsInstance";
  extra = "ByItsInstance has a field of its own";
  area() {
    return "the area of ByItsInstance";
  }
}
export class ByEvaluatedText extends Shape {
  sides = 9;
  name = "ByEvaluatedText";
  extra = "ByEvaluatedText has a field of its own";
  area() {
    return "the area of ByEvaluatedText";
  }
}
export class ByAFunctionMadeOfText extends Shape {
  sides = 10;
  name = "ByAFunctionMadeOfText";
  extra = "ByAFunctionMadeOfText has a field of its own";
  area() {
    return "the area of ByAFunctionMadeOfText";
  }
}
export class ByAComputedName extends Shape {
  sides = 11;
  name = "ByAComputedName";
  extra = "ByAComputedName has a field of its own";
  area() {
    return "the area of ByAComputedName";
  }
}
export class ByApply extends Shape {
  sides = 12;
  name = "ByApply";
  extra = "ByApply has a field of its own";
  area() {
    return "the area of ByApply";
  }
}
export class BySpecies extends Shape {
  sides = 13;
  name = "BySpecies";
  extra = "BySpecies has a field of its own";
  area() {
    return "the area of BySpecies";
  }
}
export class AsAParent extends Shape {
  sides = 14;
  name = "AsAParent";
  extra = "AsAParent has a field of its own";
  area() {
    return "the area of AsAParent";
  }
}

export function OldStyle() {
  this.sides = 1;
  this.name = "old style";
}
OldStyle.prototype = Object.create(Shape.prototype);
OldStyle.prototype.area = function () {
  return "the area of an old style shape";
};
