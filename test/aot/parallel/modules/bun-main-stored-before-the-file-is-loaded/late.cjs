exports.me = module;
exports.atLoad = [require.main === module, require.main !== module, typeof require.main];
if (require.main === module) console.log("late.cjs runs as the main module");
