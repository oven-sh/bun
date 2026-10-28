// Text that is evaluated at run time puts the name of a field that most objects leave empty on what it finds above an object that it is handed, and tries Object.prototype.
import { olds, points, round, tried } from "../objects-with-a-field-left-empty";

const name = process.argv.length > 99 ? "early" : "late";
round("before");
new Function("object", `Object.getPrototypeOf(object).${name} = 7`)(points[1]);
round("a function out of text");
new Function("object", `delete Object.getPrototypeOf(object).${name}`)(points[1]);
const old = olds[1];
eval(`old.__proto__.${name} = { x: 'x', y: 1 }`);
round("a direct eval");
eval(`delete old.__proto__.${name}`);
(globalThis as any).handed = points[2];
(0, eval)(`Object.setPrototypeOf(handed, { ${name}: "text" })`);
round("an indirect eval");
tried("Object.prototype", () => (0, eval)(`Object.prototype.${name} = "text"`));
round("behind that");
