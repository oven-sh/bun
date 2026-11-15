// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.js
// The same in JavaScript, where no type checker looks at the file: the pragmas are the only mention of the imported factory and fragment, and tags the only mention of the components.
/* @jsxRuntime classic */
/* @jsx make */
/* @jsxFrag Group */
import { Group, make } from "./factory.js";
import * as ui from "./ui.js";
import { Plain } from "./ui.js";

console.log(<><Plain /><ui.Member /></>);

// FILE: factory.js
export function Group(props) { return "group(" + props.children.join("+") + ")"; }
export function make(tag, props, ...children) { return typeof tag === "function" ? tag({ ...props, children }) : tag + "(" + children.join("+") + ")"; }

// FILE: ui.js
export function Plain() { return "plain"; }
export function Member() { return "member"; }
export function Unused() { return "unused"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
