import * as self from "./late.mjs";

export const seenEarly = [];
for (const name of ["width", "height"]) {
  try {
    seenEarly.push(name + " " + String(self[name]));
  } catch (error) {
    seenEarly.push(name + " threw " + error.constructor.name);
  }
}
seenEarly.push("own keys " + Reflect.ownKeys(self).map(String).join());
try {
  seenEarly.push("keys " + Object.keys(self).join());
} catch (error) {
  seenEarly.push("keys threw " + error.constructor.name);
}

export var width = 30;
export let height = 40;
