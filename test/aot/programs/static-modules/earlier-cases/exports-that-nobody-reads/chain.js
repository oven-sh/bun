exports.a = exports.b = function keptByB() { return "b"; };
function withExtra() { return "extra"; }
exports.f = withExtra; exports.f.extra = 1;
