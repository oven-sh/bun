const show = (name, promise) => promise.then(
  ns => console.log(name, "loaded", Object.keys(ns).join()),
  error => console.log(name, error.name, error.message),
);
await show("graph", import("./graph.mjs"));
await show("again", import("./again.cjs"));
