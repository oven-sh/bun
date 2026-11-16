import * as it from "./kettle.mjs";
(globalThis.ran ??= []).push("tray");
export const name = "tray over " + it.name;
export const pour = x => "tray " + x;
