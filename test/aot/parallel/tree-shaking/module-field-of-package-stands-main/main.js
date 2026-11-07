// package.json has "main" (a CommonJS file) and "module" (an ES module that is a barrel), as packages built for bundlers have. The program only imports the package. `bun run` takes "main"; `bun build --compile` takes "module". An executable built with --aot holds the file that one built without it holds.
// Reference: bun build --compile
import { picked } from "by-module";

console.log(picked());
