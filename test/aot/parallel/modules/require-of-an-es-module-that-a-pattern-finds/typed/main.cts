const pick = (name: string): unknown => require(`./pages/${name}.mts`);
const page = pick(JSON.parse('"home"') as string);
console.log(typeof page, typeof page === "function" ? (page as () => string)() : Object.keys(page as object).join());
