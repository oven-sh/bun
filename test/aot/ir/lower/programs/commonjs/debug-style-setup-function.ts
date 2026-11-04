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
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="createDebug"
// CHECK-NEXT: v2 = String string="x"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="createDebug"
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="a"
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = Call v3, -, v9, v10 calleeName="d"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="createDebug"
// CHECK-NEXT: v14 = PropGet v13 key="namespaces"
// CHECK-NEXT: v15 = Builtin builtin=Object
// CHECK-NEXT: v16 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="createDebug"
// CHECK-NEXT: v19 = Call v16, v15, v18 calleeName="Object.keys"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = PropGet v20 key="join"
// CHECK-NEXT: v22 = Call v21, v20 calleeKey="join" calleeName="join"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v24 = Call v8, v6, v11, v14, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
