var looked = require("./stores-late.cjs");
var holder = looked && looked.marker ? looked : { default: looked };
module.exports = [typeof looked, looked.marker, looked.default, typeof holder, holder === looked, typeof holder.default].join();
