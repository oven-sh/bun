// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 3

// FILE: main.ts
// A CommonJS module whose setup function lays the members of what it is handed on the function that it exports.
import openShop from "./cjs_shop_index.js";
const shop = openShop as any;
shop.takes(shop.load());
console.log(shop("x")("a", 1), shop.stock, Object.keys(shop).join());

// FILE: cjs_shop_counter.js
module.exports = function furnish(tools) {
	for (const name of Object.keys(tools)) openShop[name] = tools[name];
	openShop.takes = takes;
	openShop.doors = [];
	return openShop;
	function openShop(sign) {
		const sold = (...goods) => sign + "=" + goods.length + goods.join("/");
		sold.sign = sign;
		return sold;
	}
	function takes(goods) {
		openShop.stock = goods;
		openShop.keep(goods);
	}
};

// FILE: cjs_shop_index.js
module.exports = require('./cjs_shop_tools.js');

// FILE: cjs_shop_tools.js
let kept = [];
exports.prices = [25, 40, 95];
exports.keep = function keep(goods) { kept.push(goods); };
exports.load = function load() { return "a load of " + kept.length; };
exports.count = count;
function count(...goods) { return goods.length + kept.length; }
module.exports = require('./cjs_shop_counter.js')(exports);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
