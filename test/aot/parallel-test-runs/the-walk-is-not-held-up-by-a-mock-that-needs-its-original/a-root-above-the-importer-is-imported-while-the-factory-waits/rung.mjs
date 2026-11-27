import { Base } from "./base.mjs";
globalThis.rungs = (globalThis.rungs || 0) + 1;
export class Derived extends Base {}
