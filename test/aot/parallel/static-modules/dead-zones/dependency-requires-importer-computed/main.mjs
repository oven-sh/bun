// No import leads from d.mjs back to a.mjs: it asks for it by a name that it puts together, while a.mjs waits for its imports. a.mjs has begun, so it is handed out as it is: `x` is in its dead zone.
// d.mjs has an `export` of its own. Without one the loader behind `import` reads it as CommonJS, whatever its name: then it runs while the graph is loaded, a.mjs has not begun, and the `require` runs a.mjs there and then:
// ../../../../modules-run-in-the-order-of-plain-bun.test.ts.
// Entry points: ./a.mjs
import "./a.mjs";
