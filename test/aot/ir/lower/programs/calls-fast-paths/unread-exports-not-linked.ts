// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// CHECK-LABEL: function {{*}}name="all"

// FILE: main.ts
// A module is imported by import(), and only some members of its namespace object are ever read. What the others export is no part of the program: neither the functions, nor the classes with their members and fields, nor the variables with what is made for them.
const lines: string[] = [];
async function all(): Promise<void> {
    const { used, UsedClass, usedTable } = await import("./things.ts");
    lines.push(used(), new UsedClass().usedMethod(), String(usedTable.usedEntry));
    const names = require("./things.ts") as typeof import("./things.ts");
    lines.push(typeof names.used);
}
all().then(() => console.log(lines.join("\n")));

// FILE: things.ts
export function neverLinked(): string { return helperOfNeverLinked(); }
function helperOfNeverLinked(): string { return "never linked"; }
export class NeverLinkedClass {
    neverLinkedField = 1;
    neverLinkedMethod(): string { return "only in the method that is never linked" + this.neverLinkedField; }
}
export const neverLinkedTable = { neverLinkedEntry: 1 };
export const neverLinkedArrow = (): number => neverLinkedTable.neverLinkedEntry;
export function used(): string { return "used"; }
export class UsedClass { usedMethod(): string { return "a method that is used"; } }
export const usedTable = { usedEntry: 2 };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
