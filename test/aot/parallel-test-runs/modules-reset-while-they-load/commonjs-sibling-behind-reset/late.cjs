globalThis.runs ??= {}; globalThis.runs.lateCjs = (globalThis.runs.lateCjs ?? 0) + 1; exports.run = globalThis.runs.lateCjs;
