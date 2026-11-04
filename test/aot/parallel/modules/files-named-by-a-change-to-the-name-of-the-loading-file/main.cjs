const loads = {
  "require, __filename.replace()": () => require(__filename.replace("main.cjs", "first.cjs")),
  "require, replaceAll()": () => require(__filename.replaceAll("main.cjs", "second.cjs")),
  "require, slice() and a text": () => require(__filename.slice(0, -"main.cjs".length) + "third.cjs"),
  "import(), __filename.replace()": async () => (await import(__filename.replace("main.cjs", "fourth.mjs"))).default,
  "require, a pattern at the end": () => require(__filename.replace(/\.cjs$/, ".helper.cjs")),
  "require, a pattern": () => require(__filename.replace(/main/, "eighth")),
  "no such file": () => require(__filename.replace("main.cjs", "none.cjs")),
};
(async () => {
  for (const [name, load] of Object.entries(loads)) {
    try {
      console.log(name + ":", await load());
    } catch (error) {
      console.log(name + ":", error.code);
    }
  }
  await import("./module.mjs");
})();
