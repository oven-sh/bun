'use strict';

var rollupLeaf = require('./rollup-leaf.cjs');

function _interopNamespace(e) {
	if (e && e.__esModule) return e;
	var n = Object.create(null);
	if (e) {
		Object.keys(e).forEach(function (k) {
			if (k !== 'default') {
				var d = Object.getOwnPropertyDescriptor(e, k);
				Object.defineProperty(n, k, d.get ? d : {
					enumerable: true,
					get: function () { return e[k]; }
				});
			}
		});
	}
	n.default = e;
	return Object.freeze(n);
}

var leaf = /*#__PURE__*/_interopNamespace(rollupLeaf);

function sum(count) {
    let total = new leaf.Rollup(0, 0);
    for (let i = 0; i < count; i++)
        total = total.add(new leaf.Rollup(i, 1));
    return total.x + total.y;
}
exports.sum = sum;
exports.name = leaf.default;
exports.plain = Object.isFrozen(leaf);
