// A `--define` whose value is `module` makes a `.js` file a CommonJS file, which may hold no `import` statement: plain Bun stops at the statement, and so does the build.
// Flags: --define M=module --define E=exports --define A=arguments --define R=require --define D=__dirname
import { sep } from "node:path";
console.log(
  typeof M,
  typeof sep,
  (function () {
    return typeof this;
  })(),
);
/* Build errors:
error: TS100106: Cannot use import statement with CommonJS-only features
*/
