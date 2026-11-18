// evaluated text stores into an import whose module has not yet initialized what it exports
import { told } from "./first.mjs";
console.log(told.join("\n"));
