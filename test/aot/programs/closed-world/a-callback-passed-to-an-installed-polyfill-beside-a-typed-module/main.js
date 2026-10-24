const programs = {
  0: () => import("./polyfill.js"),
  1: () => import("./typed.ts"),
};
await programs[0]();
