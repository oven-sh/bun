const loads = {
  "import(), import.meta.url.replace()": () => import(import.meta.url.replace("module.mjs", "fifth.mjs")),
  "import(), import.meta.path.replace()": () => import(import.meta.path.replace("module.mjs", "sixth.mjs")),
  "import(), a pattern at the end": () => import(import.meta.url.replace(/module\.mjs$/, "ninth.mjs")),
  "import(), import.meta.filename.replace()": () => import(import.meta.filename.replace("module.mjs", "seventh.mjs")),
};
for (const [name, load] of Object.entries(loads)) {
  try {
    console.log(name + ":", (await load()).default);
  } catch (error) {
    console.log(name + ":", error.code);
  }
}
