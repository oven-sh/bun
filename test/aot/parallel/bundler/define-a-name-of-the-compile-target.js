// `bun build --compile` defines process.platform and process.arch for its target, and replaces them where the last step is written `.platform`. A --define of the same name is the program's own: it is replaced in every spelling.
// Flags: --define=process.arch="mine"
// Reference: bun build --compile
Object.defineProperty(process, "platform", { value: "made up" });
Object.defineProperty(process, "arch", { value: "made up" });
console.log(process.platform === "made up", process["platform"], process?.platform, process?.["platform"]);
console.log(process.arch, process["arch"], process?.arch, process?.["arch"]);
console.log(typeof process.versions.bun, process.versions["bun"] === process.versions?.bun);
