// The names of `barrel.js` are known when its two CommonJS modules have run. A name that a TypeScript file re-exports may be a type.
// RUN(EXPORT): link
// EXPORT: module {{*}}displayPath="{{*}}required-names.ts" {{*}}requiredNames=[{module=[[barrel]] name="second"}, {module=[[barrel]] name="first" mayBeAbsent=true}]

// RUN(UNTYPED): link
// UNTYPED: module {{*}}displayPath="{{*}}untyped.js" {{*}}requiredNames=[{module=[[barrel]] name="first"}]

import { second } from "./imports/stars/barrel.js";
import "./imports/stars/untyped.js";
export { first } from "./imports/stars/barrel.js";
export const read = second;
