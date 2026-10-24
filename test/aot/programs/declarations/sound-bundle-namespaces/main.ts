// A bundle of namespaces that hold both types and code: each is a variable that a function fills, beside a namespace of its types alone.
import { explain, far, util, type Loose } from "./bundle";

const loose: Loose = { x: 3 };
const point: util.P = { x: 3, y: 4 };
const key: util.deep.Key = "b";
console.log("through the functions:", far(point, key, 12), far({ x: 0, y: 0 }, "a", "abc"), explain("said"), explain({ message: "held" }), explain());
console.log("through the object:", util.dist(point), util.dist(point, { x: 3, y: 0 }), JSON.stringify(util.origin), util.deep.keys.join());
console.log("its keys:", Object.keys(util).join(), Object.keys(util.deep).join(), typeof util.dist, loose.x, loose.y);
