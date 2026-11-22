// A file that throws runs again at the next require(), with a new `module`. Whoever kept the first one finds on it what the file had made of `exports`: deleted, a getter, or the exports of that first run.
globalThis.runs = 0;
for (const name of ["./deleted.cjs", "./getter.cjs", "./untouched.cjs"]) {
  globalThis.passes = false;
  try {
    if (name === "./deleted.cjs") require("./deleted.cjs");
    if (name === "./getter.cjs") require("./getter.cjs");
    if (name === "./untouched.cjs") require("./untouched.cjs");
  } catch (error) {
    console.log(name, "caught", error.message);
  }
  const kept = globalThis.kept;
  console.log(name, "exports" in kept, typeof kept.exports, kept.exports?.run, typeof Object.getOwnPropertyDescriptor(kept, "exports")?.get);
  globalThis.passes = true;
  const again = name === "./deleted.cjs" ? require("./deleted.cjs") : name === "./getter.cjs" ? require("./getter.cjs") : require("./untouched.cjs");
  console.log(name, again.run, globalThis.kept === kept, "exports" in kept, typeof kept.exports, kept.exports?.run);
}
