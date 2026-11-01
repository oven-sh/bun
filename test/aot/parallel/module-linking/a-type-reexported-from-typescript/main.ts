// Reference: bun build --compile
import * as ns from "./mid"; import { real, type T } from "./mid"; const t: T = { a: real }; console.log(Object.keys(ns).join(), t.a);
