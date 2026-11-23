import { tools } from "./barrel.mjs";
const key = JSON.parse('"alpha"');
console.log(String(Object.hasOwn(tools, key)));
console.log(String(Object.prototype.hasOwnProperty.call(tools, "beta")));
console.log(String(Object.prototype.propertyIsEnumerable.call(tools, "beta")));
console.log(String(Object.isSealed(tools)), String(Object.isFrozen(tools)));
console.log(String("alpha" in tools), String(key in tools), Object.keys(tools).join(), Reflect.ownKeys(tools).length);
