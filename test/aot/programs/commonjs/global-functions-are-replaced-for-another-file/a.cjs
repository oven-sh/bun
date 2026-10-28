exports.now = () => typeof Date.now() === "number" && Date.now() > 100 ? "real" : Date.now();
exports.parse = () => parseInt("12px");
exports.enc = () => encodeURIComponent("a b");
