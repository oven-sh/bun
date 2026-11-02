// 214's own question, asked of a loader: an import by name holds what lay on the object of the module when the module was first loaded, not what is stored there later.
import process from "node:process";
import { getBuiltinModule } from "node:process";
const original = process.getBuiltinModule;
console.log("the import is the function of the object:", getBuiltinModule === original);
process.getBuiltinModule = () => "replaced";
console.log("the property behind the store:", process.getBuiltinModule("node:path"));
console.log("the import behind the store:", typeof getBuiltinModule(["node:", "path"].join("")).basename, getBuiltinModule === original);
process.getBuiltinModule = original;
