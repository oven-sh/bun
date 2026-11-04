const { "./modules/b.ts": second, "./modules/a.ts": first } = import.meta.glob("./modules/*.ts") as any;
console.log((await second()).default, (await first()).run());
