// `import widgets = require("..")` of a module that a `declare module` block describes and that no file or package stands behind. The load of the file that holds it fails, as under `bun run`, and whoever asked for that file can catch the failure.
const say = (error: any) => console.log(error.name, error.code, error.specifier);
await import("./asks").catch(say);
console.log("goes on");
