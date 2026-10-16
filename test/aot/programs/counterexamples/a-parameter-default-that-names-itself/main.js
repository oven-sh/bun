// `function make(a = a)` throws a ReferenceError when the top-level const that calls it is evaluated.
import("./m.js").then(() => console.log("evaluated"), e => console.log(e.name));
