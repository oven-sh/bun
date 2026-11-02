exports.me = module;
exports.isMain = () => require.main === module;
exports.call = () => "called in other";
