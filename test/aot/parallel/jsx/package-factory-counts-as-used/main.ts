// Under noUnusedLocals, an import counts as used when the jsxFactory of the package's own tsconfig.json names it. An import that nothing reads is still reported.
import { element } from "./widgets/element.tsx";
console.log(JSON.stringify(element));
/* Build errors:
error: TS6133: 'unused' is declared but its value is never read.
*/
