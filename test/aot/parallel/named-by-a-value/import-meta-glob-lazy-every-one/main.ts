const lazy = import.meta.glob("./modules/*.ts") as any;
for (const path of Object.keys(lazy).sort()) console.log(path, (await lazy[path]()).default);