import * as shapes from "./shapes.js";
import { attempt } from "./show.js";
import * as use from "./use.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const square = new shapes.Square(i % 5);
  sum += use.describe(square).length + use.sides(square) + use.area(square) + use.keys(square).length;
}
console.log("sum", sum);

const decoded = text => Buffer.from(text, "hex").toString();
const table = { chosen: shapes.ByATable };
class Listed extends Array {
  static get [Symbol.species]() {
    return shapes.BySpecies;
  }
}
const makers = {
  square: () => new shapes.Square(3),
  byReflect: () => Reflect.construct(shapes.ByReflect, []),
  byReflectWithAnotherTarget: () => Reflect.construct(shapes.Square, [3], shapes.ByReflect),
  byATable: () => new table[decoded("63686f73656e")](),
  bound: () => new (shapes.Bound.bind(null))(),
  byItsInstance: () => new (Object.create(shapes.ByItsInstance.prototype).constructor)(),
  byEvaluatedText: () => eval("new shapes.ByEvaluatedText()"),
  byAFunctionMadeOfText: () => new Function("shapes", "return new shapes.ByAFunctionMadeOfText()")(shapes),
  byAComputedName: () => new shapes[decoded("427941436f6d70757465644e616d65")](),
  byApply: () => new (Function.prototype.bind.apply(shapes.ByApply, [null]))(),
  bySpecies: () => new Listed().map(item => item),
  asAParent: () => new (class extends shapes.AsAParent {})(),
  oldStyle: () => new shapes.OldStyle(),
  oldStyleByCall: () => {
    const made = Object.create(shapes.OldStyle.prototype);
    shapes.OldStyle.call(made);
    return made;
  },
  onlyThePrototype: () => Object.create(shapes.Square.prototype),
};
for (const maker in makers) for (const name in use) attempt(name + "(" + maker + ")", () => use[name](makers[maker]()));
