const show = dep => { try { return dep.value() + ":" + String(dep.kind) + ":" + String(dep.added); } catch (e) { return e.name; } };
exports.seen = async () => show(await import("dep"));
