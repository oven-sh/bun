import bcrypt from "bcrypt";
import bcryptjs from "bcryptjs";
import { timed } from "./lib_http.ts";

const salt = "$2b$08$abcdefghijklmnopqrstuu";
const native = bcrypt.hashSync("password", salt);
console.log(native, bcryptjs.hashSync("password", salt) === native);
console.log(await bcrypt.compare("password", native), await bcrypt.compare("other", native), bcrypt.getRounds(native));
await timed("native, 10 rounds", () => bcrypt.hash("password", 10));
await timed("JavaScript, 10 rounds", () => bcryptjs.hash("password", 10));
console.log("DONE");
