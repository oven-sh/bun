let kept;
export const keep = it => { kept = it; };
export const show = () => { try { return kept.value() + ":" + Object.keys(kept).sort().join("+"); } catch (e) { return e.name; } };
