// Runs while exports.js is in its dead zone, and exports some of its names at other positions.
import * as exported from "./exports.js";

function attempt(action) {
  try {
    return `returned ${String(action())}`;
  } catch (error) {
    return `threw ${error.name}`;
  }
}

globalThis.namespaceInDeadZone = exported;
const untyped = globalThis.namespaceInDeadZone;

export const probes = [
  ["read", attempt(() => untyped.value00)],
  ["keys", attempt(() => Object.keys(untyped))],
  ["descriptor", attempt(() => Object.getOwnPropertyDescriptor(untyped, "value00"))],
  ["in", attempt(() => "value00" in untyped)],
  ["has", attempt(() => Reflect.has(untyped, "Zebra"))],
  ["own keys", attempt(() => Reflect.ownKeys(untyped).length)],
  ["hoisted", attempt(() => untyped.hoisted())],
];

export const aFirst = "first";
export const aSecond = "second";
export const aThird = "third";
export let counter = 2000;
export const value10 = 1010;
export const value20 = 1020;
