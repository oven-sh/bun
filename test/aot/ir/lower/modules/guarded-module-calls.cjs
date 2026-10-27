// RUN(LOAD): lower
// LOAD-LABEL: function {{*}}name="load"
// LOAD: [[expected]] = ModuleBuiltin builtin=ModuleRequire module=m
// LOAD-NEXT: [[same]] = StrictEq [[callee]], [[expected]]
// LOAD-NEXT: Branch [[same]] -> taken [[matched]](), notTaken [[other]](| 0)
// LOAD: [[matched]]():
// LOAD: EvaluateModule module=m

// RUN(LOADCALL): lower
// LOADCALL-LABEL: function {{*}}name="load"
// LOADCALL: [[specifier]] = String string="./imports/common.cjs"
// LOADCALL: Branch {{*}}notTaken [[other]](| 0)
// LOADCALL: [[other]]([[callee]]):
// LOADCALL-NEXT: = Call [[callee]], -, [[specifier]] calleeName="require"

// RUN(NATIVE): lower
// NATIVE-LABEL: function {{*}}name="native"
// NATIVE: = PropGet {{*}}key="getBuiltinModule"
// NATIVE: [[expected]] = Builtin builtin=ProcessGetBuiltinModule
// NATIVE-NEXT: [[same]] = StrictEq [[callee]], [[expected]]
// NATIVE-NEXT: Branch [[same]] -> taken [[matched]](), notTaken [[other]](| 0)
// NATIVE: [[matched]]():
// NATIVE-NEXT: = RequireModule module=m

// RUN(NATIVECALL): lower
// NATIVECALL-LABEL: function {{*}}name="native"
// NATIVECALL: [[process]] = Builtin builtin=Process
// NATIVECALL: [[name]] = String string="node:buffer"
// NATIVECALL: Branch {{*}}notTaken [[other]](| 0)
// NATIVECALL: [[other]]([[callee]]):
// NATIVECALL-NEXT: = Call [[callee]], [[process]], [[name]] calleeName="process.getBuiltinModule"

require = wrap(require);

function wrap(loader) {
  return loader;
}

function load() {
  return require("./imports/common.cjs");
}

function native() {
  return process.getBuiltinModule("node:buffer");
}

module.exports = { load, native };
