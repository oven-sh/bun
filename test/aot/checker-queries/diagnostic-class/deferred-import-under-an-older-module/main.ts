// Which `module` takes `import defer` is a rule about what tsc writes. Bun runs it, and the rest of the import is checked.
import defer * as later from "./later.ts";
import defer * as twice from "./later.ts";
const twice = 2;
export const sum = later.seven + twice;
