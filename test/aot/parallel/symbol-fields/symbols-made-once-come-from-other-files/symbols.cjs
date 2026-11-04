const kRequired = Symbol("required");
module.exports = { kRequired, kInline: Symbol("inline"), count: (globalThis.countOfRuns = (globalThis.countOfRuns ?? 0) + 1) };
