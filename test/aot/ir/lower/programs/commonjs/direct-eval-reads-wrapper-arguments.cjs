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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 captures=[{type=object flags=[IsFromCompiler] variableName="arguments"}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: object, v1: object, v2: anything, v3: function, v4: anything, v5: int[0, 4294967295], v6: undefined|null|string, v7: Array):
// CHECK-NEXT: v8 = CreateMappedArguments v3, v5, v7, v6
// CHECK-NEXT: v9 = ToThis v2
// CHECK-NEXT: v10 = NewObject layout=[[L_1]]
// CHECK-NEXT: v11 = Null
// CHECK-NEXT: SetLiteralPrototype v10, v11
// CHECK-NEXT: v13 = FinishObject v10
// CHECK-NEXT: v14 = NewObject -, v8 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v15 = ScopeHasBinding v13 key="eval"
// CHECK-NEXT: Branch v15 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Jump -> next b5(v13, v16)
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = ScopeHasBinding v1 key="eval"
// CHECK-NEXT: Branch v17 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Jump -> next b5(v1, v18)
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Jump -> next b5(v19, v19)
// CHECK-NEXT: b5(v20, v21):
// CHECK-NEXT: v22 = TypeTest v20 testedType=object
// CHECK-NEXT: Branch v22 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: v24 = PropGet v23 key="eval"
// CHECK-NEXT: Jump -> next b8(v24)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="eval" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8(v28)
// CHECK-NEXT: b8(v29):
// CHECK-NEXT: v30 = GetMappedArgument v8
// CHECK-NEXT: v31 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v32 = StrictEq v29, v31
// CHECK-NEXT: Branch v32 -> taken b9(), notTaken b10(| 0)
// CHECK-NEXT: b9():
// CHECK-NEXT: v33 = DirectEval v30, v9, v4, v8, v13, v14, v1, v0 evalScope=e15
// CHECK-NEXT: Jump -> next b11(v33)
// CHECK-NEXT: b10(v34):
// CHECK-NEXT: v35 = Call v34, v21, v30 calleeName="eval"
// CHECK-NEXT: Jump -> next b11(v35)
// CHECK-NEXT: b11(v36):
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
