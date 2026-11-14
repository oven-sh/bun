import { ask } from "../ask.mjs";
import { frozen, sealed, tested, listed, named, untouched } from "./all.mjs";

ask("export * as", frozen, sealed, tested, listed, named, untouched);
