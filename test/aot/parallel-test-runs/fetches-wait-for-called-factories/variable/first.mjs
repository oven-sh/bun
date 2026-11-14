import { reader } from "./reader.mjs";
import { second } from "./second.mjs";
import { between } from "./between.mjs";
export const first = () => ["first", reader(), second(), between()].join(", ");
