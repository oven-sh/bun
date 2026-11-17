// The file that requires the path runs before the text has been evaluated: the loader loads the file without a type.
import { early } from "./early.mjs";
import * as text from "./data.json" with { type: "text" };
console.log(Object.keys(text).join(), typeof text.default);
console.log(Object.keys(early).join(), early.port, early === text);
