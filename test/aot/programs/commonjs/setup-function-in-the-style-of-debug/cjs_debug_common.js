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
