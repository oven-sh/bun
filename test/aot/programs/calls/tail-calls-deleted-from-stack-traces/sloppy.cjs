function t_sloppy_tail(callee) { return callee(); }
exports.t_sloppy_outer = function t_sloppy_outer(callee) { var trace = t_sloppy_tail(callee); return trace + ""; };
