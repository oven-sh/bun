// The names of `barrel.js` are known when its two CommonJS modules have run. A name that a TypeScript file re-exports is required like any other.
// RUN(EXPORT): link
// EXPORT: module {{*}}displayPath="{{*}}required-names.ts" {{*}}requiredNames=[{module=[[barrel]] name="second"}, {module=[[barrel]] name="first"}]

// RUN(UNTYPED): link
// UNTYPED: module {{*}}displayPath="{{*}}untyped.js" {{*}}requiredNames=[{module=[[barrel]] name="first"}]

import { second } from "./imports/stars/barrel.js";
import "./imports/stars/untyped.js";
export { first } from "./imports/stars/barrel.js";
export const read = second;
