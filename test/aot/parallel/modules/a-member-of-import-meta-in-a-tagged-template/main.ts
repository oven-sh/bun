// A member of import.meta is written into a tagged template, as in $`ls ${import.meta.dir}`: it is read, and nothing gets hold of import.meta.
// Before: the build took import.meta for changed, read no path made of import.meta.dir in the whole file, and the executable ended with "Cannot find module '/$bunfs/root/plugins/first.ts'".
const tag = (texts: TemplateStringsArray, ...values: unknown[]) => texts.join("|") + values.length;
const name = process.argv.length > 9 ? "other" : "first";
console.log(tag`in ${import.meta.file} now`);
const loaded = await import(import.meta.dir + "/plugins/" + name + ".ts");
console.log(loaded.default);
