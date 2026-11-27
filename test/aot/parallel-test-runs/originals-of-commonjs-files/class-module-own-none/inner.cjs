let k = 0;
exports.rate = 1;
exports.fee = () => "inner" + ++k;
exports.show = () => exports.fee();
