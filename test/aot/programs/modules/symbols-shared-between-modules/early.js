// Evaluated before late.js, whose function it calls: the key of late.js is not made yet.
import { readLate } from "./late.js";
export let outcome;
try { outcome = String(readLate({})); } catch (error) { outcome = error.constructor.name; }
