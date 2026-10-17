if (typeof process === 'undefined' || process.type === 'renderer') {
	module.exports = require('./cjs_debug_node.js');
} else {
	module.exports = require('./cjs_debug_node.js');
}
