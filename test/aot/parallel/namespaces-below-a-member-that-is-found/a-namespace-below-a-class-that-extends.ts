class Shape {}
namespace Shape.Tools {
  export function first() { return 1; }
}
class Path extends Shape {}
namespace Path.Tools {
  export function second() { return 2; }
}
console.log(Object.keys(Shape.Tools).join(), Object.hasOwn(Path, "Tools"), Path.Tools === (Shape.Tools as unknown), Path.Tools.second());
export {};
