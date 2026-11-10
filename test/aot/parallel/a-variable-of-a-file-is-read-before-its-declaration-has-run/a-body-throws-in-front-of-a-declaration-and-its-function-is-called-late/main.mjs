try { await import("./holder.mjs"); } catch (error) { console.log("import threw", error.message); }
for (let turn = 0; turn < 2; turn++) {
  try { console.log("late", globalThis.readLate()); } catch (error) { console.log("late threw", error.constructor.name + ":", error.message); }
}
