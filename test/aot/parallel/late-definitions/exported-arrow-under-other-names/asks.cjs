const pick = name => (process.argv.length > 100 ? "x" : "") + name;
exports.ask = () => { const m = require(pick("./m.mjs")); return [typeof m.renamed, m.renamed === m.default, m[pick("other")](), m.renamed(4)].join(); };
exports.take = () => require(pick("./m.mjs")).renamed;
