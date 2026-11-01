import { ask } from "../ask.mjs";
import * as frozen from "./frozen.cjs";
import * as sealed from "./sealed.cjs";
import * as tested from "./tested.cjs";
import * as listed from "./listed.cjs";
import * as named from "./named.cjs";
import * as untouched from "./untouched.cjs";

ask("a CommonJS file", frozen, sealed, tested, listed, named, untouched);
