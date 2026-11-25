'use strict';

var rollupLeaf = require('./rollup-leaf.cjs');

const version = '1.0';

exports.version = version;
Object.keys(rollupLeaf).forEach(function (k) {
	if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
		enumerable: true,
		get: function () { return rollupLeaf[k]; }
	});
});
