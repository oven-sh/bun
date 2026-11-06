// The entry point imports the default of a CommonJS file and reads `default` of it alone, and the file requires the entry point back. No importer binds a name of the file.
import whole from "./file.cjs";
console.log(typeof whole.default);
