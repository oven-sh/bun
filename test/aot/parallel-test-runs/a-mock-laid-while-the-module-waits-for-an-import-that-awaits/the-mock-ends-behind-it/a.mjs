import { text } from "./d.mjs"; globalThis.bodies = (globalThis.bodies || 0) + 1; export const state = "early " + text; export const get = () => "real " + state;
