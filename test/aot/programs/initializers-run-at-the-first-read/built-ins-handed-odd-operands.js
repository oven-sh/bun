// Built-ins handed what makes them run code or throw.
const log = [];
function attempt(name, make) { try { log.push(name + " " + JSON.stringify(make())); } catch (error) { log.push(name + " threw " + error.name); } }
const SYMBOLS = [Symbol("s")];
let JOIN_SYMBOLS; try { JOIN_SYMBOLS = SYMBOLS.join(); } catch (error) { log.push("join threw " + error.name); }
let TEMPLATE; try { TEMPLATE = `${SYMBOLS[0]}`; } catch (error) { log.push("template threw " + error.name); }
let MIXED; try { MIXED = [1n].map(n => n + 1); } catch (error) { log.push("bigint threw " + error.name); }
let REPEATED; try { REPEATED = ["ab"].map(s => s.repeat(-1)); } catch (error) { log.push("repeat threw " + error.name); }
let BAD_SET; try { BAD_SET = new Set(5); } catch (error) { log.push("Set threw " + error.name); }
let BAD_MAP; try { BAD_MAP = new Map([1, 2]); } catch (error) { log.push("Map threw " + error.name); }
let BAD_LENGTH; try { BAD_LENGTH = new Array(-1); } catch (error) { log.push("Array threw " + error.name); }
let NULL_KEYS; try { NULL_KEYS = Object.keys(null); } catch (error) { log.push("keys threw " + error.name); }
let STARTS; try { STARTS = ["a"].map(s => s.startsWith(/a/)); } catch (error) { log.push("startsWith threw " + error.name); }
let REPLACE_ALL; try { REPLACE_ALL = ["a"].map(s => s.replaceAll(/a/, "b")); } catch (error) { log.push("replaceAll threw " + error.name); }
let NORMALIZED; try { NORMALIZED = ["a"].map(s => s.normalize("bad")); } catch (error) { log.push("normalize threw " + error.name); }
const HOLES = [1, , 3];
const HOLES_MAPPED = HOLES.map(n => n * 2);
const HOLES_JOINED = HOLES.join("-");
const HOLES_SET = new Set(HOLES);
const SPARSE = []; SPARSE[5] = 1;
const SPARSE_FLAT = SPARSE.flatMap(n => [n]);
class Sub extends Array {}
const SUB = Sub.from([1, 2]);
const SUB_MAPPED = SUB.map(n => n);
const FROZEN = Object.freeze([1, 2]);
let FROZEN_PUSH; try { FROZEN_PUSH = FROZEN.push(3); } catch (error) { log.push("push threw " + error.name); }
const FROZEN_OBJECT = Object.freeze({ a: 1 });
"use strict";
attempt("holes", () => [HOLES_MAPPED, HOLES_JOINED, [...HOLES_SET], 1 in HOLES_MAPPED, SPARSE_FLAT]);
attempt("sub", () => [SUB_MAPPED instanceof Sub, SUB_MAPPED.constructor.name, SUB_MAPPED]);
attempt("frozen", () => [Object.isFrozen(FROZEN), Object.isFrozen(FROZEN_OBJECT), FROZEN]);
attempt("undefined ones", () => [JOIN_SYMBOLS, TEMPLATE, MIXED, REPEATED, BAD_SET, BAD_MAP, BAD_LENGTH, NULL_KEYS, STARTS, REPLACE_ALL, NORMALIZED].map(v => typeof v));
console.log(log.join("\n"));
