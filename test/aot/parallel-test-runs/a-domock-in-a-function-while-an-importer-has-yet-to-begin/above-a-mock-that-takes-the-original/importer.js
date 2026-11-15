import { who } from "./dep.js";
import { tag } from "./mocked.js";
console.log("SAID the importer begins and reads", who());
export const viaImporter = () => who() + ", " + tag();
