exports.a = 1;
switch (1) { case 1: function exports() {} }
module.exports.seen = [typeof exports, Object.keys(exports).join()];
