for (const name of ["./holder.mjs", "./reader.mjs", "./reader.mjs"]) {
  try { const found = await import(name === "./holder.mjs" ? "./holder.mjs" : "./reader.mjs"); console.log(name, found.readLimit?.()); } catch (error) { console.log(name, "threw", error.constructor.name + ":", error.message); }
}
