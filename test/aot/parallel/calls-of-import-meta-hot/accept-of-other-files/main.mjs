import { value } from "./accept-of-other-files.helper.mjs";
import.meta.hot.accept("./accept-of-other-files.helper.mjs", (next) => { console.log("never", next); });
import.meta.hot.accept(["./accept-of-other-files.helper.mjs"], () => {});
console.log(value);
