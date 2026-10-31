// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.cjs
// A `var` or a function declaration of a sloppy direct eval is hoisted to the variables of the enclosing function. Where it meets a `let`, `const` or `class` on the way, at the top level of the function too, the eval throws a SyntaxError before it runs anything, and the binding keeps its value.
function attempt(work) { try { return String(work()); } catch (error) { return error.name; } }
function overLet() { let taken = 1; const answer = attempt(() => eval("var taken = 2")); return answer + " " + taken; }
function overLetDirectly() { let taken = 1; let answer; try { answer = eval("var taken = 2; 'declared'"); } catch (error) { answer = error.name; } return answer + " " + taken; }
function overConst() { const taken = 1; let answer; try { answer = eval("var taken = 2; 'declared'"); } catch (error) { answer = error.name; } return answer + " " + taken; }
function overClass() { class Taken {} let answer; try { answer = eval("var Taken = 2; 'declared'"); } catch (error) { answer = error.name; } return answer + " " + typeof Taken; }
function overLetInBlock() { { let taken = 1; let answer; try { answer = eval("var taken = 2; 'declared'"); } catch (error) { answer = error.name; } return answer + " " + taken; } }
function functionOverLet() { let taken = 1; let answer; try { answer = eval("function taken() {} 'declared'"); } catch (error) { answer = error.name; } return answer + " " + typeof taken; }
function blockFunctionOverLet() { let taken = 1; let answer; try { answer = eval("{ function taken() {} } 'declared'"); } catch (error) { answer = error.name; } return answer + " " + typeof taken; }
function nothingRunsBefore() { let taken = 1; let ran = "no"; try { eval("ran = 'yes'; var taken = 2"); } catch {} return ran + " " + taken; }
function beforeTheDeclaration() { let answer; try { answer = eval("var later = 2; 'declared'"); } catch (error) { answer = error.name; } let later = 1; return answer + " " + later; }
function overVar() { var free = 1; let answer; try { answer = eval("var free = 2; 'declared'"); } catch (error) { answer = error.name; } return answer + " " + free; }
function overParameter(free) { let answer; try { answer = eval("var free = 2; 'declared'"); } catch (error) { answer = error.name; } return answer + " " + free; }
function overFunction() { function free() {} let answer; try { answer = eval("var free = 2; 'declared'"); } catch (error) { answer = error.name; } return answer + " " + free; }
function overCatchParameter() { try { throw 1; } catch (free) { let answer; try { answer = eval("var free = 2; 'declared'"); } catch (error) { answer = error.name; } return answer + " " + free; } }
function overCatchPattern() { try { throw { taken: 1 }; } catch ({ taken }) { let answer; try { answer = eval("var taken = 2; 'declared'"); } catch (error) { answer = error.name; } return answer + " " + taken; } }
function inArrow() { let free = 1; const answer = (() => { try { return eval("var free = 2; 'declared ' + free"); } catch (error) { return error.name; } })(); return answer + " " + free; }
function inInnerFunction() { let free = 1; function inner() { try { return eval("var free = 2; 'declared ' + free"); } catch (error) { return error.name; } } return inner() + " " + free; }
function strictText() { let free = 1; let answer; try { answer = eval("'use strict'; var free = 2; 'declared ' + free"); } catch (error) { answer = error.name; } return answer + " " + free; }
function letInText() { let free = 1; let answer; try { answer = eval("let free = 2; 'declared ' + free"); } catch (error) { answer = error.name; } return answer + " " + free; }
function newName() { let other = 1; let answer; try { answer = eval("var added = 2; 'declared'"); } catch (error) { answer = error.name; } return answer + " " + added + " " + other; }
function readsAndStores() { let kept = 1; const fixed = 2; eval("kept = kept + fixed"); return kept; }
function storeToConst() { const fixed = 1; return attempt(() => eval("fixed = 2")) + " " + fixed; }
let topLevel = 1;
let atTopLevel; try { atTopLevel = eval("var topLevel = 2; 'declared'"); } catch (error) { atTopLevel = error.name; }
for (const row of [overLet, overLetDirectly, overConst, overClass, overLetInBlock, functionOverLet, blockFunctionOverLet, nothingRunsBefore, beforeTheDeclaration, overVar, overParameter, overFunction, overCatchParameter,
  overCatchPattern, inArrow, inInnerFunction, strictText, letInText, newName, readsAndStores, storeToConst])
  console.log(row.name, "|", row(1));
console.log("at the top level of a CommonJS module |", atTopLevel, topLevel);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: inArrow Taken inner
// CHECK-LABEL: function {{*}}name="inArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: object, v2: object, v3: anything, v4: function, v5: anything, v6: int[0, 4294967295], v7: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v8 = CreateMappedArguments v4, v6, v7
// CHECK-NEXT: v9 = ToThis v3
// CHECK-NEXT: v10 = NewObject -, v8 layout=[[L_3]] fields=[2]
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v10, v12 layout=[[L_3]]
// CHECK-NEXT: v14 = NewClosure v0, v10, v1, v2, v9, v5, v8 function=[[f_4]]
// CHECK-NEXT: v15 = Call v14
// CHECK-NEXT: PutEnvironmentField v10, v15 layout=[[L_3]] field=1
// CHECK-NEXT: v17 = String string=" "
// CHECK-NEXT: v18 = Add v15, v17
// CHECK-NEXT: v19 = GetEnvironmentField v10 layout=[[L_3]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="free"
// CHECK-NEXT: v21 = Add v18, v20
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Taken"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inner"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=env [[L_6]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: env [[L_6]], v2: object, v3: object, v4: anything, v5: function, v6: anything, v7: int[0, 4294967295], v8: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v9 = CreateMappedArguments v5, v7, v8
// CHECK-NEXT: v10 = ToThis v4
// CHECK-NEXT: v11 = NewObject layout=[[L_8]]
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: SetLiteralPrototype v11, v12
// CHECK-NEXT: v14 = FinishObject v11
// CHECK-NEXT: v15 = NewObject -, v9 layout=[[L_9]] fields=[0]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b14():
// CHECK-NEXT: v16 = ScopeHasBinding v14 key="eval"
// CHECK-NEXT: Branch v16 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3() handler=b14():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Jump -> next b7(v14, v17)
// CHECK-NEXT: b4() handler=b14():
// CHECK-NEXT: v18 = ScopeHasBinding v3 key="eval"
// CHECK-NEXT: Branch v18 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5() handler=b14():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Jump -> next b7(v3, v19)
// CHECK-NEXT: b6() handler=b14():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Jump -> next b7(v20, v20)
// CHECK-NEXT: b7(v21, v22) handler=b14():
// CHECK-NEXT: v23 = TypeTest v21 testedType=object
// CHECK-NEXT: Branch v23 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v24) handler=b14():
// CHECK-NEXT: v25 = PropGet v24 key="eval"
// CHECK-NEXT: Jump -> next b10(v25)
// CHECK-NEXT: b9(v26) handler=b14():
// CHECK-NEXT: v27 = Builtin builtin=GlobalThis
// CHECK-NEXT: v28 = PropGet v27 key="eval" [isFreeName]
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b10(v29)
// CHECK-NEXT: b10(v30) handler=b14():
// CHECK-NEXT: v31 = String string="var free = 2; 'declared ' + free"
// CHECK-NEXT: v32 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v33 = StrictEq v30, v32
// CHECK-NEXT: Branch v33 -> taken b11(), notTaken b12(| 0)
// CHECK-NEXT: b11() handler=b14():
// CHECK-NEXT: v34 = DirectEval v31, v10, v6, v1, v0, v14, v15, v3, v2 evalScope=e20
// CHECK-NEXT: Jump -> next b13(v34)
// CHECK-NEXT: b12(v35) handler=b14():
// CHECK-NEXT: v36 = Call v35, v22, v31 calleeName="eval"
// CHECK-NEXT: Jump -> next b13(v36)
// CHECK-NEXT: b13(v37) handler=b14():
// CHECK-NEXT: Return v37
// CHECK-NEXT: b14() role=CatchHandler:
// CHECK-NEXT: v38 = CatchValue
// CHECK-NEXT: v39 = PropGet v38 key="name"
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
