console.log("SAID body of tax");
exports.rate = 1;
exports.fee = async () => { await 0; return exports.rate; };
exports.show = () => exports.fee().then(it => it + 1);
