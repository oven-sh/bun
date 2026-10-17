// `export default x` above `const x` throws a ReferenceError when the module is evaluated.
import("./lib.js").then(m => console.log(m.default.v), e => console.log(e.name));
