console.log(globalThis.__byEvaluatedText);
try {
  new Function("globalThis.__byEvaluatedText = () => 'by a function made of text'")();
  (0, eval)("var __byAVarOfAScript = () => 'a var'; function __byAFunctionOfAScript() { return 'a function'; }");
} catch (error) { console.log("refused:", error.name); }
console.log(globalThis.__byEvaluatedText?.(), globalThis.__byAVarOfAScript?.(), globalThis.__byAFunctionOfAScript?.());
