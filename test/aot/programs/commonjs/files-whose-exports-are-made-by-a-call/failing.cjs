function make(v) { return { value: v }; } module.exports = make("half"); throw new Error("failing.cjs threw");
