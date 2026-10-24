// A function, an arrow and a class that are stored to `exports.f` get no name: only a store to an identifier, and a property of a literal, name a function.
import { f, g, K, h } from "./a.cjs";
console.log(JSON.stringify([f.name, g.name, K.name, h.name]));
const byRequire = require("./a.cjs"),
  literal = require("./literal.cjs");
console.log(JSON.stringify([byRequire.f.name, byRequire.g.name, byRequire.K.name, literal.n.name, literal.m.name]));
