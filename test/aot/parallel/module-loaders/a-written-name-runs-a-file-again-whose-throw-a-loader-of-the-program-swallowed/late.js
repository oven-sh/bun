globalThis.late = (globalThis.late ?? 0) + 1; if (globalThis.late === 1) throw new Error("made up too"); module.exports = { whole: 2 };
