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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=object flags=[IsFromCompiler] variableName="arguments"}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: object, v1: object, v2: anything, v3: function, v4: anything, v5: int[0, 4294967295], v6: Array):
// CHECK-NEXT: v7 = CreateMappedArguments v3, v5, v6
// CHECK-NEXT: v8 = ToThis v2
// CHECK-NEXT: v9 = NewObject -, v7 layout=[[L_1]] fields=[2]
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v9, v11 layout=[[L_1]]
// CHECK-NEXT: v13 = NewClosure v9, v0, v1, v8, v4, v7 function=[[f_2]]
// CHECK-NEXT: v14 = Call v13
// CHECK-NEXT: PutEnvironmentField v9, v14 layout=[[L_1]] field=1
// CHECK-NEXT: v16 = String string=" "
// CHECK-NEXT: v17 = Add v14, v16
// CHECK-NEXT: v18 = GetEnvironmentField v9 layout=[[L_1]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="free"
// CHECK-NEXT: v20 = Add v17, v19
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Taken"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inner"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler] variableName="arguments"}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_4]], v1: object, v2: object, v3: anything, v4: function, v5: anything, v6: int[0, 4294967295], v7: Array):
// CHECK-NEXT: v8 = CreateMappedArguments v4, v6, v7
// CHECK-NEXT: v9 = ToThis v3
// CHECK-NEXT: v10 = NewObject layout=[[L_5]]
// CHECK-NEXT: v11 = Null
// CHECK-NEXT: SetLiteralPrototype v10, v11
// CHECK-NEXT: v13 = FinishObject v10
// CHECK-NEXT: v14 = NewObject -, v8 layout=[[L_6]] fields=[0]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b13():
// CHECK-NEXT: v15 = ScopeHasBinding v13 key="eval"
// CHECK-NEXT: Branch v15 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2() handler=b13():
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Jump -> next b6(v13, v16)
// CHECK-NEXT: b3() handler=b13():
// CHECK-NEXT: v17 = ScopeHasBinding v2 key="eval"
// CHECK-NEXT: Branch v17 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4() handler=b13():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Jump -> next b6(v2, v18)
// CHECK-NEXT: b5() handler=b13():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Jump -> next b6(v19, v19)
// CHECK-NEXT: b6(v20, v21) handler=b13():
// CHECK-NEXT: v22 = TypeTest v20 testedType=object
// CHECK-NEXT: Branch v22 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v23) handler=b13():
// CHECK-NEXT: v24 = PropGet v23 key="eval"
// CHECK-NEXT: Jump -> next b9(v24)
// CHECK-NEXT: b8(v25) handler=b13():
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="eval" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v28)
// CHECK-NEXT: b9(v29) handler=b13():
// CHECK-NEXT: v30 = String string="var free = 2; 'declared ' + free"
// CHECK-NEXT: v31 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v32 = StrictEq v29, v31
// CHECK-NEXT: Branch v32 -> taken b10(), notTaken b11(| 0)
// CHECK-NEXT: b10() handler=b13():
// CHECK-NEXT: v33 = DirectEval v30, v9, v5, v0, v13, v14, v2, v1 evalScope=e20
// CHECK-NEXT: Jump -> next b12(v33)
// CHECK-NEXT: b11(v34) handler=b13():
// CHECK-NEXT: v35 = Call v34, v21, v30 calleeName="eval"
// CHECK-NEXT: Jump -> next b12(v35)
// CHECK-NEXT: b12(v36) handler=b13():
// CHECK-NEXT: Return v36
// CHECK-NEXT: b13() role=CatchHandler:
// CHECK-NEXT: v37 = CatchValue
// CHECK-NEXT: v38 = PropGet v37 key="name"
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
