const show = dep => { try { return dep.value() + ":" + String(dep.kind) + ":" + String(dep.added); } catch (e) { return e.name; } };
export const seen = async () => { const dep = await import("dep"); return show(dep) + ":" + Object.keys(dep).sort().join("+"); };
