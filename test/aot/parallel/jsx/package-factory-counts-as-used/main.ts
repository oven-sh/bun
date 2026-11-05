// The jsxFactory of the package's own tsconfig.json makes the element. A build that reports type errors stops at TypeScript's error: under noUnusedLocals the import that the factory names counts as used, and TS6133: 'unused' is declared but its value is never read.
// Reference: bun build --compile
import { element } from "./widgets/element.tsx";
console.log(JSON.stringify(element));
