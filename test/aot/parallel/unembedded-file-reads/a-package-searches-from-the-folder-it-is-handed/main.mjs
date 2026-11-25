// The package.json that a package finds from the folder that it is handed is in the executable.
import readManifest from "find-manifest";
console.log(readManifest.sync({ cwd: import.meta.dirname })?.name);
