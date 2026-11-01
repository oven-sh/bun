function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

import { cfg, readA } from "./a.mjs";
let seen;
try { seen = { held: cfg, more: make("m") }; } catch (e) { seen = e.name; }
export const holder = (() => { try { return { held: readA(), more: make("n") }; } catch (e) { return e.name; } })();
export const fromB = () => [typeof seen === "string" ? seen : "object", typeof holder === "string" ? holder : "object"].join();
