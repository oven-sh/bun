// Own value 0 of what is made (emitter) comes out by from entries.
import { EventEmitter } from "node:events";
function use(e) { return typeof e; }
const m = new EventEmitter();
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
