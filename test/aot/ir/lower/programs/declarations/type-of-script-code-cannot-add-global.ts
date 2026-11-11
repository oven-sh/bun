// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// CHECK-LABEL: function {{*}}name="labelOf"
// CHECK-LABEL: function {{*}}name="orZero"

// FILE: main.ts
// `Node` and `Event` are interfaces and variables of the library, so a type alias or a class of that name is a duplicate in a script, and `status` is a variable of another type there. A build runs the file as a module, where such a name is the file's own.
type Node = { own: number; next: Node | null };
declare class Event {
  constructor(label: number);
  label: number;
}
declare var status: number | undefined;
const node: Node = { own: 1, next: { own: 2, next: null } };
function labelOf(event: Event): number {
  return event.label;
}
function orZero(value: number | undefined): number {
  return value ?? 0;
}
console.log(node.own + node.next!.own, labelOf({ label: 3 }), typeof status === "undefined" ? "none" : orZero(status));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "auto", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [ "main.ts" ] }
