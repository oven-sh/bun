import { ask } from "../ask.mjs";
import * as frozen from "./frozen.mjs";
import * as sealed from "./sealed.mjs";
import * as tested from "./tested.mjs";
import * as listed from "./listed.mjs";
import * as named from "./named.mjs";
import * as untouched from "./untouched.mjs";

ask("import * as", frozen, sealed, tested, listed, named, untouched);
