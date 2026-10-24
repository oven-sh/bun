// The same as module-without-code-required-while-its-imports-run, but the build cannot tell which module the require() names:
// the module without code is being evaluated while its imports run, so the require() answers at once and the import that comes later waits for its turn.
import { first, second } from "./without-code.mjs";
console.log("main runs:", first, second);
