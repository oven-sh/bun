const { basename } = require('node:path');
exports.read = x => basename(x);
