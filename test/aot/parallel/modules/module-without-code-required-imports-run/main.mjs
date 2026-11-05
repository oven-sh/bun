// In plain Bun a module without code of its own is being evaluated while the modules it imports run, so a require() of it from one of them answers at once with its namespace:
// the imports that come later wait for their turn. A module without code that the evaluation has not come to yet is evaluated by the require(), with all of its imports that have not run.
import { first, second } from "./without-code.mjs";
import "./importer-of-shared.mjs";
import { shared, third } from "./later-without-code.mjs";
console.log("main runs:", first, second, shared, third);
