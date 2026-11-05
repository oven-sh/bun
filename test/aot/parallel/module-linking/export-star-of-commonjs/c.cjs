exports.fromCjs = 1; exports.late = undefined; setTimeout(() => { exports.late = "late"; exports.added = "added"; }, 0); exports.default = "cjs default";
