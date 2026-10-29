// A package needs a global type that the lib of the application lacks.
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# a-dependency-that-needs-a-global-type-missing-from-the-appli");
await import("./a-dependency-that-needs-a-global-type-missing-from-the-appli/main.ts");
await settled();
