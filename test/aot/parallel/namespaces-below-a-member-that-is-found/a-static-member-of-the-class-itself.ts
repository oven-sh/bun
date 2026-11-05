class Shape {
  static Tools: any = { own: true };
}
// @ts-ignore
namespace Shape.Tools {
  export const mark = "set";
}
console.log(JSON.stringify(Shape.Tools));
export {};
