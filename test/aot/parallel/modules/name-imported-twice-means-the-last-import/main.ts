// @ts-ignore
import { value } from "./texts";
// @ts-ignore
import { value } from "./numbers";
// @ts-ignore
import { Shape } from "./texts";
// @ts-ignore
import { Shape } from "./numbers";
// @ts-ignore
import { make } from "./texts";
// @ts-ignore
import make from "./numbers";
// @ts-ignore
import * as whole from "./texts";
// @ts-ignore
import { other as whole } from "./numbers";
// @ts-ignore
import { value as space } from "./never-loaded";
// @ts-ignore
import * as space from "./numbers";
// @ts-ignore
import first, * as first from "./numbers";
// @ts-ignore
import second, { other as second } from "./numbers";
// @ts-ignore
import { value as thrice } from "./never-loaded";
// @ts-ignore
import { value as thrice } from "./texts";
// @ts-ignore
import { other as thrice } from "./numbers";
// @ts-ignore
import { Kind } from "./kinds";
// @ts-ignore
import { Kind } from "./numbers";
// @ts-ignore
import { other as typed } from "./numbers";
// @ts-ignore
import type { Kind as typed } from "./kinds";
// @ts-ignore
import { value as required } from "./never-loaded";
// @ts-ignore
import required = require("./numbers");
// @ts-ignore
import { value as own } from "./never-loaded";
// @ts-ignore
import { value as own } from "./never-loaded";
const own = "of the file";
// @ts-ignore
import { join as path } from "node:path";
// @ts-ignore
import { basename as path } from "node:path";
import { handedOn, makeHandedOn, ShapeHandedOn } from "./through";

function sum(count: number) {
  let total = 0;
  for (let i = 0; i < count; i++) total += value + whole + thrice;
  return total;
}

function withDefault(n = value) {
  return n + 1;
}

const shape = new Shape(3);
console.log(value + 1, sum(10), withDefault());
console.log(shape.size * 2, shape instanceof Shape, Object.keys(shape).join());
console.log(make(4), whole - 1, thrice - 1);
console.log(Object.keys(space).join(), space.value + 1);
console.log(first(5), second + 1);
console.log(Kind.level + 1, typed + 1);
console.log(required.value + 1, own);
console.log(path("a/b/c.txt"));
console.log(handedOn + 1, makeHandedOn(6), new ShapeHandedOn(7).size + 1);
export { value, whole };
