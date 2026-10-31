// A callback passed to an installed polyfill beside a typed module.
const programs = {
  0: () => import("./polyfill.js"),
  1: () => import("./typed.ts"),
};
await programs[0]();
