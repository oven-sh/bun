import { log } from "./log";
const target = { size: 1 };
const withTraps = Object.freeze(new Proxy({ size: 1 }, {
  preventExtensions(of) { log.push("preventExtensions"); return Reflect.preventExtensions(of); },
  ownKeys(of) { log.push("ownKeys"); return Reflect.ownKeys(of); },
}));
const withoutTraps = Object.freeze(new Proxy(target, {}));
export function isTargetFrozen(): boolean { return Object.isFrozen(target); }
export function readAll(): number { return [withTraps, withoutTraps].length; }
