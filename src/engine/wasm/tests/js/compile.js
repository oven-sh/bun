var { Module, Instance, CompileError, LinkError } = WebAssembly;

var log = [];
var builder = new Builder();
builder.importFunction("m", "start", builder.addType([], [])).start = 0;
var bytes = builder.toBytes();
var imports = () => logging(log, { m: { start: () => log.push("start") } });
var notObject = (position, name) => position + " argument to WebAssembly." + name + " must be undefined or an Object";
var invalid = new Builder();
invalid.addFunction(invalid.addType([], []), [], [0x1a]);
var invalidMessage =
  "WebAssembly.Module doesn't parse at byte 2: can't pop empty stack in can't drop on empty stack, in function at index 0";
var truncatedMessage = "WebAssembly.Module doesn't parse at byte 9: can't get Type section's length";

runAsync(async () => {
  // The bytes are copied at once, and nothing is settled before the next task.
  var copy = bytes.slice();
  var promise = WebAssembly.compile(copy).then(it => (log.push("compiled"), it));
  copy.fill(0);
  for (var index = 0; index < 10; index++) await null;
  assertDeepEq(log, []);
  var module = await promise;
  assert(module instanceof Module);

  // The imports for a module are read at once, those for bytes once they are compiled.
  log = [];
  promise = WebAssembly.instantiate(module, imports());
  assertDeepEq(log, ["m"]);
  assert((await promise) instanceof Instance);
  assertDeepEq(log, ["m", "start"]);
  for (var [name, source] of [
    ["instantiate", bytes],
    ["instantiateStreaming", bytes],
    ["instantiateStreaming", Promise.resolve(bytes)],
  ]) {
    log = [];
    promise = WebAssembly[name](source, imports());
    assertDeepEq(log, []);
    var result = await promise;
    assertDeepEq([log, Object.keys(result)], [["m", "start"], ["module", "instance"]]);
    assert(result.module instanceof Module && result.instance instanceof Instance);
    await rejects(TypeError, notObject("second", name), WebAssembly[name](source, null));
    await rejects(TypeError, notObject("third", name), WebAssembly[name](source, {}, 1));
    await rejects(LinkError, "import function m:start must be callable", WebAssembly[name](source, { m: {} }));
    var thrown = { m: { start: () => fail("in start") } };
    await rejects(Error, "in start", WebAssembly[name](source, thrown));
  }
  await rejects(TypeError, "import m:start must be an object", WebAssembly.instantiate(module, {}));
  assert((await WebAssembly.compileStreaming(bytes)) instanceof Module);

  for (var name of ["compile", "instantiate", "compileStreaming", "instantiateStreaming"]) {
    await rejects(CompileError, invalidMessage, WebAssembly[name](invalid.toBytes()));
    await rejects(CompileError, truncatedMessage, WebAssembly[name](bytes.subarray(0, 9)));
  }
  for (var name of ["compile", "instantiate"]) {
    await rejects(TypeError, "first argument must be an ArrayBufferView or an ArrayBuffer", WebAssembly[name]());
  }
  for (var name of ["compile", "compileStreaming"]) {
    await rejects(TypeError, notObject("second", name), WebAssembly[name](bytes, "options"));
    await rejects(TypeError, "builtins list option values must be strings", WebAssembly[name](bytes, { builtins: [1] }));
  }
  for (var name of ["compileStreaming", "instantiateStreaming"]) {
    await rejects(Error, "rejected", WebAssembly[name](Promise.reject(new Error("rejected"))));
    await rejects(Error, "no response", WebAssembly[name](new Error("no response")));
  }

  var many = await Promise.all(Array.from({ length: 200 }, () => WebAssembly.instantiate(bytes, imports())));
  assertEq(new Set(many.map(it => it.instance)).size, 200);
});
