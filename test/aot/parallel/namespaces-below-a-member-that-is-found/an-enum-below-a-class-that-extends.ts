class Shape {}
namespace Shape {
  export enum Kind { Round = 1 }
}
class Path extends Shape {}
namespace Path {
  export enum Kind { Long = 2 }
}
console.log(JSON.stringify(Shape.Kind), Object.hasOwn(Path, "Kind"), Path.Kind.Long);
export {};
