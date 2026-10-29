// A package with an error that has no place in a file.
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# a-circular-auto-accessor-in-a-dependency-demotes-the-depende");
await import("./a-circular-auto-accessor-in-a-dependency-demotes-the-depende/main.ts");
await settled();
console.log("# mismatched-type-parameters-on-an-unnamed-default-class-in-a-");
await import("./mismatched-type-parameters-on-an-unnamed-default-class-in-a-/main.ts");
await settled();
