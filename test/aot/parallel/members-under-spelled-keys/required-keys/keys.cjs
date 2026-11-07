const kept = Symbol("kept");
exports.kept = kept;
exports.word = "word";
exports.Base = class Base { [kept]() { return "base"; } plain() { return "plain"; } };
