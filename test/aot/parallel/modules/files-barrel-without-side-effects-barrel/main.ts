// The package says that its files have no side effects, and the files behind each `export *` import the barrel back: they run in the order of the barrel's lines.
import { Base, User } from "./models";
import { Third, First, Second } from "./three";
import { Leaf, Root } from "./nested";
import * as shapes from "./shapes";

console.log(Base.make() instanceof User);
console.log(new Third().names().join());
console.log(First.name, Second.name);
console.log(new Leaf() instanceof Root);
console.log(new shapes.Square(2).area(), shapes.Shape.count);
