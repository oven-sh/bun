exports.factory = async () => { await 0; return { a: "mocked", n: -1 }; };
exports.ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
