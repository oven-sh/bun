import whole, * as main from "./main.cjs";
import { first, read } from "./main.cjs";
console.log("binds", first, read, whole.first, whole.late, Object.keys(main).join());
