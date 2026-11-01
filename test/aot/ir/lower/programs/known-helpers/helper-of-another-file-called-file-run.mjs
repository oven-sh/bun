// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
// A helper that is a variable of another file, called while that file has not started: on a cycle of imports the importer runs first.
import "./helpers.mjs";

// FILE: a-helper-of-another-file-called-before-that-file-has-run/helpers.mjs
import "./user.mjs";
export var __classPrivateFieldIn = function(state, receiver) {
    if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
    return typeof state === "function" ? receiver === state : state.has(receiver);
};

// FILE: a-helper-of-another-file-called-before-that-file-has-run/main.mjs
// A helper that is a variable of another file, called while that file has not started: on a cycle of imports the importer runs first.
import "./helpers.mjs";

// FILE: a-helper-of-another-file-called-before-that-file-has-run/user.mjs
import { __classPrivateFieldIn } from "./helpers.mjs";
class C {}
try {
    console.log(__classPrivateFieldIn(C, {}));
} catch (error) {
    console.log(error.constructor.name);
}

// FILE: helpers.mjs
import "./user.mjs";
export var __classPrivateFieldIn = function(state, receiver) {
    if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
    return typeof state === "function" ? receiver === state : state.has(receiver);
};

// FILE: user.mjs
import { __classPrivateFieldIn } from "./helpers.mjs";
class C {}
try {
    console.log(__classPrivateFieldIn(C, {}));
} catch (error) {
    console.log(error.constructor.name);
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
