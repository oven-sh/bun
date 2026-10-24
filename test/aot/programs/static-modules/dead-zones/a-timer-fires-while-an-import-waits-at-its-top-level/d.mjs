import { f } from "./a.mjs";
setTimeout(() => {
  try {
    console.log("timer", f());
  } catch (error) {
    console.log("timer", error.constructor.name);
  }
}, 1);
