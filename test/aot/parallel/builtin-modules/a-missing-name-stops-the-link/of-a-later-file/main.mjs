// A name that node:os lacks stops the link of a file that an import() loads, each time, and runs nothing of its graph; a file with the same imports but for that name loads.
const tell = (name, start) =>
  start().then(
    () => console.log(name, "is loaded"),
    error => console.log(name, error.name + ": " + error.message),
  );
await tell("bad.mjs", () => import("./bad.mjs"));
await tell("bad.mjs again", () => import("./bad.mjs"));
await tell("good.mjs", () => import("./good.mjs"));
