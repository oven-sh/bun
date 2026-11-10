import { callAll, early } from "./importer.mjs";
var readByExpression = function (o) { return KEY === undefined ? "early" : o[KEY]; };
export class Reader { read(o) { return KEY === undefined ? "early" : o[KEY]; } }
early.push("called " + callAll());
var KEY = "a";
export { readByExpression };
export function read(o) { return KEY === undefined ? "early" : o[KEY]; }
