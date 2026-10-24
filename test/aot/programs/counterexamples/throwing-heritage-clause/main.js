// `class extends Bound` with a bound class throws a TypeError when the module is evaluated.
import("./module.ts").then(module => console.log("no error", Object.keys(module).join()), e => console.log(e.name));
