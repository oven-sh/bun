exports.me = module;
exports.isMain = () => require.main === module;
exports.main = () => require.main;
exports.call = () => "called in other";
