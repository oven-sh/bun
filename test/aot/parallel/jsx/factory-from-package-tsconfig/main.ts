// JSX in a package uses the jsx, jsxFactory and jsxFragmentFactory of the package's own tsconfig.json, not the program's react-jsx.
// Reference: bun build --compile
import { element } from "./widgets/element.tsx";
console.log(JSON.stringify(element));
