import path from "node:path";
export async function rows(names) {
  const row = async (name, load) => {
    try {
      console.log(name, JSON.stringify((await load()).default));
    } catch (error) {
      console.log(name, "throws", error.code);
    }
  };
  await row("import.meta.dir, all written", () => import(import.meta.dir + "/lib/first.js"));
  await row("import.meta.dirname, all written", () => import(`${import.meta.dirname}/lib/second.js`));
  await row("join of import.meta.dir", () => import(path.join(import.meta.dir, "lib", "first.js")));
  for (const name of names) {
    await row("import.meta.dir and a name", () => import(`${import.meta.dir}/lib/${name}.js`));
    await row("import.meta.dirname and a name", () => import(import.meta.dirname + "/lib/" + name + ".js"));
    await row("join of import.meta.dirname and a name", () => import(path.join(import.meta.dirname, "lib", name + ".js")));
  }
}
