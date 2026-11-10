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
