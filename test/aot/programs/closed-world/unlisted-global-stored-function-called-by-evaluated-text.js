globalThis.__calledByText = value => "called by text with " + value;
try {
  console.log(new Function("return __calledByText(5)")(), (0, eval)("globalThis.__calledByText(6)"));
} catch (error) { console.log("refused:", error.name); }
