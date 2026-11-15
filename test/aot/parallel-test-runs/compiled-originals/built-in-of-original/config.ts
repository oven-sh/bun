import { format } from "node:util";
import punycode, { encode } from "node:punycode";
const kept = format;
export const read = () => kept("%s", "config") + encode("ü") + (punycode.encode === encode);
