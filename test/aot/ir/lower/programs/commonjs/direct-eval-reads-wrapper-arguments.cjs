// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// The text of a direct eval names `arguments` at the top of a CommonJS file and in an arrow function there: it is the wrapper function's arguments object, mapped to the five parameters in sloppy code. In a function it is that function's.
console.log(eval("arguments.length"), eval("arguments[0] === exports"), eval("arguments[2] === module"));
const inArrow = (text) => eval(text);
console.log(inArrow("arguments.length"), inArrow("arguments[1] === require"));
function inFunction(text) { return eval(text); }
console.log(inFunction("arguments.length"), inFunction("arguments[0]"), inFunction("typeof exports"));

const firstExports = exports;
eval("arguments[0] = 'stored by the text'");
console.log(exports);
exports = "stored by the file";
console.log(eval("arguments[0]"), inArrow("exports"), inFunction("exports"));
inFunction("exports = 'stored in a function'");
console.log(eval("arguments[0]"));
exports = firstExports;

eval("arguments = ['replaced']");
console.log(eval("arguments.length"), inArrow("arguments[0]"));
eval("var arguments = 'declared by the text'");
console.log(eval("arguments"));
require("./strict.cjs");

// FILE: strict.cjs
"use strict";
console.log(eval("arguments.length"), eval("arguments[0] === exports"));
eval("arguments[0] = 'stored by the text'");
console.log(exports === module.exports, eval("arguments[0]"));
console.log(((text) => eval(text))("arguments.length"));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: inFunction
// CHECK-LABEL: function {{*}}name="inFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: object, v2: object, v3: anything, v4: function, v5: anything, v6: int[0, 4294967295], v7: undefined|null|string, v8: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v9 = CreateMappedArguments v4, v6, v8, v7
// CHECK-NEXT: v10 = ToThis v3
// CHECK-NEXT: v11 = NewObject layout=[[L_3]]
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: SetLiteralPrototype v11, v12
// CHECK-NEXT: v14 = FinishObject v11
// CHECK-NEXT: v15 = NewObject -, v9 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v16 = ScopeHasBinding v14 key="eval"
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Jump -> next b6(v14, v17)
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = ScopeHasBinding v2 key="eval"
// CHECK-NEXT: Branch v18 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Jump -> next b6(v2, v19)
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Jump -> next b6(v20, v20)
// CHECK-NEXT: b6(v21, v22):
// CHECK-NEXT: v23 = TypeTest v21 testedType=object
// CHECK-NEXT: Branch v23 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: v25 = PropGet v24 key="eval"
// CHECK-NEXT: Jump -> next b9(v25)
// CHECK-NEXT: b8(v26):
// CHECK-NEXT: v27 = Builtin builtin=GlobalThis
// CHECK-NEXT: v28 = PropGet v27 key="eval" [isFreeName]
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v29)
// CHECK-NEXT: b9(v30):
// CHECK-NEXT: v31 = GetMappedArgument v9
// CHECK-NEXT: v32 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v33 = StrictEq v30, v32
// CHECK-NEXT: Branch v33 -> taken b10(), notTaken b11(| 0)
// CHECK-NEXT: b10():
// CHECK-NEXT: v34 = DirectEval v31, v10, v5, v9, v0, v14, v15, v2, v1 evalScope=e15
// CHECK-NEXT: Jump -> next b12(v34)
// CHECK-NEXT: b11(v35):
// CHECK-NEXT: v36 = Call v35, v22, v31 calleeName="eval"
// CHECK-NEXT: Jump -> next b12(v36)
// CHECK-NEXT: b12(v37):
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
