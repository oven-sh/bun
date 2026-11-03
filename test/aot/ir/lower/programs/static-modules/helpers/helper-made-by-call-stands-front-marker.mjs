// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: ModulesWithNames >= 2
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
// TypeScript writes `__extends` as the result of a function that is called where it is written, in front of the marker. The function only makes functions, so a file that may be seen half done has its marker all the same, and its `default` is a variable.
import Derived from "./k.cjs";
import { lazy } from "./lazy.cjs";
console.log(new Derived().name(), lazy() === Derived);

// FILE: k.cjs
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var Base = /** @class */ (function () {
    function Base() {
    }
    Base.prototype.name = function () { return "base"; };
    return Base;
}());
var Derived = /** @class */ (function (_super) {
    __extends(Derived, _super);
    function Derived() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    return Derived;
}(Base));
exports.default = Derived;

// FILE: lazy.cjs
exports.lazy = function () {
  return require("./k.cjs").default;
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="Derived"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Construct v7 calleeName="Derived"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="name"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v9 calleeKey="name" calleeName="name"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v14 calleeName="lazy"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="Derived"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v20 = StrictEq v16, v19
// CHECK-NEXT: v21 = Call v4, v2, v12, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
