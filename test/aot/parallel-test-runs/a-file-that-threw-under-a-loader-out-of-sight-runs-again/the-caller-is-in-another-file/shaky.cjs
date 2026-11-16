process.env.RUNS_OF_SHAKY = String(Number(process.env.RUNS_OF_SHAKY || 0) + 1);
exports.early = process.env.RUNS_OF_SHAKY;
if (process.env.RUNS_OF_SHAKY === "1") throw new Error("cold");
exports.late = process.env.RUNS_OF_SHAKY;
