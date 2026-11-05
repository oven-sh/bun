export { x } from "./bundle.mjs";
console.log("body: a file between the bundle and the entry point");
Promise.resolve().then(() => console.log("job: a file between the bundle and the entry point"));
