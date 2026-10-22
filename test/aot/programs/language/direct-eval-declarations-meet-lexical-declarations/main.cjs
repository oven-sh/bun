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
