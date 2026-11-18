// A realm that the embedder does not let make code.

assertEq(WebAssembly.validate(emptyModuleBytes()), true);

var error = assertThrows(WebAssembly.CompileError, function () {
  new WebAssembly.Module(emptyModuleBytes());
});
assertEq(error.message, "not here (evaluating 'new WebAssembly.Module(emptyModuleBytes())')");

var rejected = [];
["compile", "instantiate", "compileStreaming", "instantiateStreaming"].forEach(function (name) {
  if (!WebAssembly[name]) return rejected.push("CompileError");
  WebAssembly[name](emptyModuleBytes()).catch(function (error) {
    rejected.push(error.name);
  });
});
later(function () {
  assertDeepEq(rejected, ["CompileError", "CompileError", "CompileError", "CompileError"]);
});
