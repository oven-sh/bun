// Bun builds its own modules with its bundler, which makes a `var` of a top-level `let` or `const`: they have no dead zone. `node:repl` reads one before its declaration has run. It also evaluates text while it loads, which a build has to admit.
import repl from "node:repl";
import * as namespace from "node:repl";
console.log(typeof repl, typeof namespace.default, typeof repl.start);
