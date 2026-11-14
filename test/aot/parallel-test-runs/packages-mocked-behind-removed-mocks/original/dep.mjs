import { name } from "pkg";
globalThis.ran = (globalThis.ran ?? 0) + 1;
export const value = () => "real " + name();
