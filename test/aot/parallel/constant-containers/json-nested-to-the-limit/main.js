// JSON nested as deep as code may be nested is compiled.
import deep from "./deep.json";
let depth = 0;
for (let at = deep; Array.isArray(at); at = at[0]) depth++;
console.log(depth);
