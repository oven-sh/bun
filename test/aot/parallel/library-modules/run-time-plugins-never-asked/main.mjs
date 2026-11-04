// A plugin that is registered at run time is never asked for a module of the program.
// Reference: bun build --compile
// That holds for a name which `bun build` links: one that is written out in the call. A name that this build follows further, through a constant or a parameter,
// brings the file into the program and decides nothing: the call asks the loader, and so the plugins first. test/aot/plugins-by-name.test.ts
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# on-load-of-a-typescript-module");
await import("./on-load-of-a-typescript-module/main.ts");
await settled();
console.log("# on-load-of-a-json-module");
await import("./on-load-of-a-json-module/main.ts");
await settled();
console.log("# on-load-of-a-commonjs-module");
await import("./on-load-of-a-commonjs-module/main.ts");
await settled();
console.log("# on-load-of-every-file");
await import("./on-load-of-every-file/main.ts");
await settled();
console.log("# on-resolve-of-the-entry-point");
await import("./on-resolve-of-the-entry-point/main.ts");
await settled();
console.log("# on-resolve-of-every-name");
await import("./on-resolve-of-every-name/main.ts");
await settled();
console.log("# on-resolve-to-another-module");
await import("./on-resolve-to-another-module/main.ts");
await settled();
console.log("# on-resolve-to-a-file-on-disk");
await import("./on-resolve-to-a-file-on-disk/main.ts");
await settled();
