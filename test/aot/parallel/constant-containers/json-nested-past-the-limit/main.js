// JSON nested one level deeper than code may be nested is a build error, not an internal compiler error.
import deep from "./deep.json";
let depth = 0;
for (let at = deep; Array.isArray(at); at = at[0]) depth++;
console.log(depth);
/* Build errors:
error: TS100301: This code is nested more than 2000 levels deep.
*/
