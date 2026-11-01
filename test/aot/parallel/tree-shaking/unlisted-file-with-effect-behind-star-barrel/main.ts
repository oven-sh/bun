// package.json lists the files that have side effects. barrel1.ts is listed and runs. beside2.ts is not listed and its export is unused, so the build leaves it out,
// as `bun build --compile` does. `bun run` ignores the list and runs it.
import { data } from "./barrel2";
console.log(data());
console.log(((globalThis as any).ran ?? []).join(" "));
/* Output:
8
setup barrel1
*/
