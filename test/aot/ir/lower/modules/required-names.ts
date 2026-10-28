// The names of `barrel.js` are known when its two CommonJS modules have run. A name that a TypeScript file re-exports is required like any other.
// A link looks for the names that a module exports ahead of those that it imports, and its error quotes the export statement.
// RUN(EXPORT): link
// EXPORT: module {{*}}displayPath="{{*}}required-names.ts" {{*}}requiredNames=[{module=[[barrel]] name="first" exportName="first" specifier="./imports/stars/barrel.js"}, {module=[[barrel]] name="second"}]

// RUN(UNTYPED): link
// UNTYPED: module {{*}}displayPath="{{*}}untyped.js" {{*}}requiredNames=[{module=[[barrel]] name="first" exportName="first" specifier="./barrel.js"}]

import { second } from "./imports/stars/barrel.js";
import "./imports/stars/untyped.js";
export { first } from "./imports/stars/barrel.js";
export const read = second;
