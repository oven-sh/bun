function make(v) { return { value: v, later: undefined }; } module.exports = make("plain"); module.exports.later = "stored later";
