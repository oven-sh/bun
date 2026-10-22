// In a TypeScript file the types are written in the code, so a tag in a comment says nothing to a build.

class Shape {
  sides(): number {
    return 0;
  }
}

class Circle {
  radius = 1;
}

/**
 * @augments Circle
 * @see Shape
 */
class Square extends Shape {
  sides(): number {
    return 4;
  }
}

/**
 * @param {string} first
 * @param missing
 * @returns {string}
 */
function count(first: number): number {
  return arguments.length + first;
}

/** @type {string} */
const total: number = count(1) + new Square().sides();

console.log(total, new Square() instanceof Shape, new Circle().radius);
