const path = require('node:path');
const one = require('./one.mjs');
exports.look = () => [one.sep, 'a'].join('-') + ' ' + (one.sep === path.sep) + ' ' + structuredClone([one.sep])[0];
