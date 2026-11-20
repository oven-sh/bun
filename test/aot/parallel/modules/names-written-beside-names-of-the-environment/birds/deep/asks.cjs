exports.fromBelow = () => require(process.env.NAME_OF_A_NEST || "#nest").eggs;
exports.byParameter = name => require(name);
