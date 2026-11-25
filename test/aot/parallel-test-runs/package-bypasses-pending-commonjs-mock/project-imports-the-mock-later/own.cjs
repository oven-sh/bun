exports.seen = () => { try { const dep = require("dep"); return dep.value() + ":" + dep.kind + ":" + Object.keys(dep).sort().join("+"); } catch (e) { return e.name; } };
