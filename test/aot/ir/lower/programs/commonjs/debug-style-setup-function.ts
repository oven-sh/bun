// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 3

// FILE: main.ts
// A CommonJS module written like the `debug` package: a setup function that copies properties onto the function it exports.
import createDebug from "./cjs_debug_index.js";
const d = (createDebug as any)("x");
console.log(d("a", 1), (createDebug as any).namespaces, Object.keys(createDebug as any).join());

// FILE: cjs_debug_common.js
function setup(env) {
	createDebug.debug = createDebug;
	createDebug.default = createDebug;
	createDebug.enable = enable;
	Object.keys(env).forEach(key => {
		createDebug[key] = env[key];
	});
	createDebug.names = [];
	function createDebug(namespace) {
		function debug(...args) { return namespace + ":" + args.join(); }
		debug.namespace = namespace;
		return debug;
	}
	function enable(namespaces) {
		createDebug.save(namespaces);
		createDebug.namespaces = namespaces;
	}
	createDebug.enable(createDebug.load());
	return createDebug;
}
module.exports = setup;

// FILE: cjs_debug_index.js
if (typeof process === 'undefined' || process.type === 'renderer') {
	module.exports = require('./cjs_debug_node.js');
} else {
	module.exports = require('./cjs_debug_node.js');
}

// FILE: cjs_debug_node.js
exports.init = init;
exports.log = log;
exports.save = save;
exports.load = load;
exports.colors = [6, 2, 3];
function log(...args) { return args.length; }
function save(namespaces) { if (namespaces) { saved = namespaces; } }
function load() { return "from-load"; }
function init(debug) { debug.inspectOpts = {}; }
let saved;
module.exports = require('./cjs_debug_common.js')(exports);
const {formatters} = module.exports;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="createDebug"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="x"
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="createDebug"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = String string="a"
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Call v5, -, v11, v12 calleeName="d"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="createDebug"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="namespaces"
// CHECK-NEXT: v18 = Builtin builtin=Object
// CHECK-NEXT: v19 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="createDebug"
// CHECK-NEXT: v22 = Call v19, v18, v21 calleeName="Object.keys"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v24 = PropGet v23 key="join"
// CHECK-NEXT: v25 = Call v24, v23 calleeKey="join" calleeName="join"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v27 = Call v10, v8, v13, v17, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
