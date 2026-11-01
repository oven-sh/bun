import * as point from "./point.mjs";
import * as uses from "./uses.mjs";

function attempt(run) {
  try {
    console.log(typeof run());
  } catch (error) {
    console.log(error.constructor.name);
  }
}
attempt(() => uses.stored(point));
for (const name in uses) attempt(() => uses[name](point));
