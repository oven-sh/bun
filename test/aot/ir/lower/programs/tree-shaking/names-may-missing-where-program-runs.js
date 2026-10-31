// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 14

// FILE: main.js
// An unused declaration reads a global that does not exist. A bare read throws, and so does a member of it; behind a typeof test it is not read at all. Each case is a file of its own, loaded here, and says whether it threw.
const loads = {
  "a bare name": () => import("./missing/bare.js"),
  "a member": () => import("./missing/member.js"),
  "in an object": () => import("./missing/in-object.js"),
  "after extends": () => import("./missing/extends.js"),
  "a statement": () => import("./missing/statement.js"),
  "typeof": () => import("./missing/typeof.js"),
  "guarded by &&": () => import("./missing/guarded-and.js"),
  "guarded by ?:": () => import("./missing/guarded-conditional.js"),
  "guarded the wrong way": () => import("./missing/guarded-wrong.js"),
  "guarded by another name": () => import("./missing/guarded-other.js"),
  "a member behind a guard": () => import("./missing/guarded-member.js"),
  "an optional chain": () => import("./missing/optional.js"),
  "globalThis.name": () => import("./missing/global-this.js"),
};
for (const name in loads) {
  try {
    await loads[name]();
    console.log(name + ": loaded");
  } catch (error) {
    console.log(name + ": " + error.name);
  }
}

// FILE: missing/bare.js
const unused = notDefinedAnywhere;

// FILE: missing/extends.js
class Unused extends notDefinedAnywhere {}

// FILE: missing/global-this.js
const unused = globalThis.notDefinedAnywhere;
const deeper = globalThis.notDefinedAnywhere?.member;

// FILE: missing/guarded-and.js
const unused = typeof notDefinedAnywhere !== "undefined" && notDefinedAnywhere;
const other = typeof notDefinedAnywhere === "undefined" || notDefinedAnywhere;

// FILE: missing/guarded-conditional.js
const unused = typeof notDefinedAnywhere === "undefined" ? null : notDefinedAnywhere;
const other = typeof notDefinedAnywhere < "u" ? notDefinedAnywhere : null;

// FILE: missing/guarded-member.js
const unused = typeof notDefinedAnywhere !== "undefined" && notDefinedAnywhere.member;

// FILE: missing/guarded-other.js
const unused = typeof alsoNotDefined === "undefined" || notDefinedAnywhere;
const second = typeof alsoNotDefined !== "function" && notDefinedAnywhere;

// FILE: missing/guarded-wrong.js
const unused = typeof notDefinedAnywhere === "undefined" && notDefinedAnywhere;

// FILE: missing/in-object.js
const unused = { key: notDefinedAnywhere, list: [notDefinedAnywhere] };

// FILE: missing/member.js
const unused = notDefinedAnywhere.member;

// FILE: missing/optional.js
const unused = notDefinedAnywhere?.member;

// FILE: missing/statement.js
notDefinedAnywhere;

// FILE: missing/typeof.js
const unused = typeof notDefinedAnywhere;
typeof notDefinedAnywhere;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: typeof
// CHECK-LABEL: function {{*}}name="typeof"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|[[L_1]]> flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = ImportModule module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Promise<undefined|null|[[L_1]]> flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
