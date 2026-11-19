// RUN(CALL): lower
// CALL-LABEL: function {{*}}name="optionalCall"
// CALL: = PropGet {{*}}key="getBuiltinModule"
// CALL: = TypeTest {{*}}testedType=undefined|null
// CALL: [[expected]] = Builtin builtin=ProcessGetBuiltinModule
// CALL-NEXT: [[same]] = StrictEq [[callee]], [[expected]]
// CALL-NEXT: Branch [[same]] -> taken [[matched]](), notTaken [[other]](| 0)
// CALL: [[matched]]():
// CALL-NEXT: = RequireModule module=m
// CALL: [[other]]([[function]]):
// CALL-NEXT: = Call [[function]], {{*}}calleeName="process.getBuiltinModule"
// CALL: Return

// RUN(OBJECT): lower
// OBJECT-LABEL: function {{*}}name="optionalObject"
// OBJECT: = TypeTest {{*}}testedType=undefined|null
// OBJECT: = PropGet {{*}}key="getBuiltinModule"
// OBJECT: [[expected]] = Builtin builtin=ProcessGetBuiltinModule
// OBJECT-NEXT: [[same]] = StrictEq [[callee]], [[expected]]
// OBJECT-NEXT: Branch [[same]] -> taken [[matched]](), notTaken [[other]](| 0)
// OBJECT: [[matched]]():
// OBJECT-NEXT: = RequireModule module=m
// OBJECT: Return

// The usual test for the feature in a library. Each link of the chain leaves for `undefined` as in an ordinary call, and behind it
// the module is loaded by its number where the callee is the built-in.
function optionalCall() {
  return process.getBuiltinModule?.("node:buffer");
}

function optionalObject() {
  return process?.getBuiltinModule("node:buffer");
}

module.exports = { optionalCall, optionalObject };
