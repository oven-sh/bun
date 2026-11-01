// Flags: --aot-validate
if (typeof Iterator.zipKeyed === "function") {
  try { [...Iterator.zipKeyed({ a: [1], b: [2, 3] }, { mode: "strict" })]; } catch (e) { console.log(e.constructor.name); }
}
