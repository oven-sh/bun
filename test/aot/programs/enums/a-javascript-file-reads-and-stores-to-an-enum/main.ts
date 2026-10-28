import { read, spoil } from "./reader.js";
import { typed } from "./typed";
console.log(read(), typed());
spoil();
console.log(read(), typed());
