var report = globalThis.report || console.log;
function evalStores(a) { eval("a = 7"); return arguments[0] + "," + a; }
function evalReads(a) { arguments[0] = 9; return eval("a") + "," + arguments[0]; }
function evalNamesArguments(a, b) { return eval("arguments.length + ',' + arguments[1]"); }
function evalDeclares(a) { eval("var a = 3"); return arguments[0] + "," + a; }
report(evalStores(1)); report(evalReads(1)); report(evalNamesArguments(1, 2, 3)); report(evalDeclares(1));
report("end");
