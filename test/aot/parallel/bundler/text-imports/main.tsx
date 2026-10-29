// Files imported as strings, an import of a declaration file, a type-only import, and a .tsx file without JSX.
// Reference: bun build --compile
import "./txt/types.d.ts"
import hello from "./txt/hello.txt"
import note from "./txt/note.md" with { type: "text" }
import { type Node } from "./mini/jsx-runtime"
const node: Node | null = null
console.log(hello.length, JSON.stringify(hello), note.split("\n")[0], node)
