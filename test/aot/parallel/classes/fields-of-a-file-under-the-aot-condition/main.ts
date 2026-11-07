// The file under the "aot" condition of a package defines its fields, whatever the tsconfig.json of the application says.
declare const console: { log(...values: unknown[]): void };
import { keys } from "fields";
console.log(keys());
