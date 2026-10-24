function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
for (let i = 0; i < 2; i++) {
  try { const m = await import("./state.js"); console.log("loaded", m.early.x, m.later.x); } catch (e) { console.log("failed", e.constructor.name, e.message); }
  console.log(globalThis.runs, attempt(globalThis.hook));
}
