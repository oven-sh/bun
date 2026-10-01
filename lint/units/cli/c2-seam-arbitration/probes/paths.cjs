// Oracle: TypeScript 6.0.2's own getNormalizedAbsolutePath and convertToRelativePath (typescript-go ports these).
const ts = require("/workspace/wt/cli/node_modules/typescript");
const cases = [
  ["/proj", "a.ts"], ["/proj", "./src/../src/a.ts"], ["/proj", "/proj/src/a.ts"], ["/proj", "/other/b.ts"],
  ["/proj", "../b.ts"], ["/proj/", "a.ts"], ["/", "a.ts"], ["/proj", "../../../b.ts"], ["/proj", "src//a.ts"],
  ["/proj", "src/./a.ts"], ["/proj", "/proj/a.ts/"], ["/proj/sub", "/proj/a.ts"], ["/proj", "/Proj/a.ts"],
  ["C:\\proj", "src\\a.ts"], ["c:/proj", "D:/x/b.ts"], ["C:/Proj", "c:/proj/a.ts"], ["c:/proj", "c:/proj/a.ts"],
  ["c:/proj", "C:/proj/sub/a.ts"], ["c:/proj", "\\\\server\\share\\a.ts"], ["//server/share/dir", "//server/share/a.ts"],
  ["/proj", "a b.ts"], ["/proj", "\u00e9.ts"], ["/proj", ""], ["/proj", "."], ["/proj", "c:a.ts"],
];
for (const [cwd, operand] of cases) {
  for (const sensitive of [true, false]) {
    const canon = ts.createGetCanonicalFileName(sensitive);
    const name = ts.getNormalizedAbsolutePath(operand, cwd);
    const display = ts.convertToRelativePath(name, ts.normalizeSlashes(cwd), canon);
    console.log(JSON.stringify([cwd, operand, sensitive, name, display]));
  }
}
