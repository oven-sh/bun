// The transpiler leaves `module?.require` as it is, so `module` is read, and the file is CommonJS for it.
console.log(module?.require("node:path").sep, module?.["require"]("node:path").sep, module.require?.("node:path").sep);
