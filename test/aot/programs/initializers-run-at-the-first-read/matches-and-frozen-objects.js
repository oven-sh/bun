// Matches leave traces: lastIndex, RegExp.$1. Frozen objects refuse stores.
"use strict";
const log = [];
const SHARED = /a(b)?/g;
const FIRST = ["xab", "ab"].map(s => SHARED.test(s));
log.push("lastIndex " + SHARED.lastIndex);
const LOCAL = ["a_b", "c_d"].map(s => s.replace(/_/g, "-"));
const SPLIT = "a1b22c".split(/\d+/);
const MATCHED = "k=v".match(/(\w)=(\w)/);
const WITH_FUNCTION = ["ab"].map(s => s.replace(/a/, m => { log.push("replacer ran"); return m.toUpperCase(); }));
log.push("after WITH_FUNCTION");
let NOT_GLOBAL; try { NOT_GLOBAL = ["a"].map(s => s.replaceAll(/a/, "b")); } catch (error) { log.push("replaceAll " + error.name); }
const STICKY = /x/y;
const STICKY_RESULTS = ["xx", "ax"].map(s => STICKY.exec(s) !== null);
log.push("sticky " + STICKY.lastIndex);
const odd = /z/; odd.exec = function () { log.push("own exec"); return null; };
const ODD = ["z"].map(s => s.replace(odd, "!"));
log.push("after ODD");

const FROZEN = Object.freeze({ a: 1 });
let stored; try { FROZEN.a = 2; stored = "stored"; } catch (error) { stored = error.name; }
const FROZEN_LIST = Object.freeze(["x"]);
let pushed; try { FROZEN_LIST.push("y"); pushed = "pushed"; } catch (error) { pushed = error.name; }
const THEN_FILLED = {}; Object.freeze(THEN_FILLED);
let filled; try { THEN_FILLED.late = 1; filled = "filled"; } catch (error) { filled = error.name; }
const inner = { n: 1 };
const SHALLOW = Object.freeze({ inner });
inner.n = 2;
function freezeLater(o) { return Object.freeze(o); }
const LATER = { k: 1 };
LATER.k = 2;
freezeLater(LATER);
const SYMBOL_A = Symbol.for("attack"), SYMBOL_B = Symbol.for("attack"), UNIQUE_A = Symbol("u"), UNIQUE_B = Symbol("u");
const KEYED = { [SYMBOL_A]: 1, [UNIQUE_A]: 2 };
const WEAK = new WeakMap(); const key = {}; WEAK.set(key, "held");
const FROM_SET = new Set(new Set([1, 2, 2])); const FROM_MAP = new Map(new Map([["a", 1]])); const SPREAD = [...new Set(["p", "p", "q"]), ...new Map([["m", 1]]).keys()];
const growing = new Set([1]); const COPIED = new Set(growing); const SPREAD_GROWING = [...growing]; growing.add(2);
log.push(JSON.stringify([FIRST, LOCAL, SPLIT, MATCHED, WITH_FUNCTION, typeof NOT_GLOBAL, STICKY_RESULTS, ODD]));
log.push(JSON.stringify([FROZEN, stored, FROZEN_LIST, pushed, filled, SHALLOW, Object.isFrozen(LATER), LATER]));
log.push([SYMBOL_A === SYMBOL_B, UNIQUE_A === UNIQUE_B, KEYED[Symbol.for("attack")], KEYED[UNIQUE_A], WEAK.get(key), [...FROM_SET], [...FROM_MAP], SPREAD, [...COPIED], SPREAD_GROWING].join(" "));
console.log(log.join("\n"));
