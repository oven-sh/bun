globalThis.runs = (globalThis.runs ?? 0) + 1;
import d, { sep } from "node:path";
import * as all from "path";
export const view = () => [d.sep, sep, all.sep, (() => sep)()].join();
export class C { m() { return sep; } }
