// Reference: bun build --compile
exports.early = "early";
const pages = import.meta.glob("./pages/*.cjs", { eager: true, import: "default" });
exports.late = "late";
console.log(JSON.stringify(pages));
