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
