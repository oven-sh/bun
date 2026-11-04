module.exports = function first() { return 1; };
module.exports.swap = () => { module.exports = function second() { return 2; }; };
