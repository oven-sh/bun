import ts from "typescript";
console.log(ts.version, ts.transpileModule("const a: number = 1;", {}).outputText.trim());
