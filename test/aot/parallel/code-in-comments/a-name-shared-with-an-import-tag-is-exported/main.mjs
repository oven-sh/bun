// What stands in a comment is no code: a name that an `@import` tag also binds is the function, class or variable that the file declares, and `export { name }` hands that out.
import renamedDefault, { renamed } from "./renamed.mjs";
import { count, bump } from "./variable.mjs";
import { Shape } from "./class.mjs";
import * as all from "./function.mjs";
import { f as throughAStar } from "./star.mjs";
import { real as local } from "./the-file-exists.mjs";
import { real as handedOn } from "./a-real-import-too.mjs";
import { f as behindATypeQuery } from "./type-query.mjs";

bump();
console.log(renamed(), renamedDefault(), count, new Shape().sides());
console.log(Object.keys(all), all.f(), throughAStar(), local(), handedOn(), behindATypeQuery());
