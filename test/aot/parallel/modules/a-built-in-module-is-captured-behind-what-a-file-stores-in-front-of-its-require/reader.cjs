const path = require('node:path');
const kept = path.sep;
path.sep = '!';
path.join = function madeUp() { return 'made up'; };
const one = require('./one.mjs');
exports.look = () => String(one.sep) + ' ' + one.join('a', 'b') + ' ' + kept;
