// Callbacks and helpers that look pure and are not.
const log: string[] = [];
let counter = 0;
const LIST = [1, 2, 3];
const COUNTED = LIST.map(n => n + counter++);
log.push("counter " + counter);
const SEEN: number[] = [];
const VISITED = LIST.filter(n => { SEEN.push(n); return n > 1; });
log.push("seen " + SEEN.join());
const STAMPED = LIST.map(() => typeof performance.now());
const RANDOM = LIST.map(() => Math.random() < 2);
let state = "before";
const READS_STATE = LIST.map(n => state + n);
state = "after";
log.push(JSON.stringify([COUNTED, VISITED, STAMPED, RANDOM, READS_STATE]));

function thrower(n: number) { if (n > 2) throw new RangeError("too big " + n); return n; }
let caught = "";
let THROWN: number[] | undefined;
try { THROWN = LIST.map(thrower); } catch (error) { caught = String(error); }
log.push(caught + " " + typeof THROWN);

const WITH_GETTER = { get value() { log.push("getter ran"); return 1; } };
const FROM_GETTER = [WITH_GETTER].map(o => o.value);
log.push("after FROM_GETTER");
log.push(JSON.stringify(FROM_GETTER));

const CONVERTED = [{ toString() { log.push("toString ran"); return "s"; } }].join("-");
log.push("after CONVERTED " + CONVERTED);
const KEYED = [{ toString() { log.push("key made"); return "k"; } }].reduce<Record<string, number>>((o, k) => { o[k as unknown as string] = 1; return o; }, {});
log.push("after KEYED " + JSON.stringify(KEYED));

const SORTED = [3, 1, 2].sort((a, b) => { counter++; return a - b; });
log.push("counter " + counter + " " + SORTED);
const ids = new Map<string, number>();
function idOf(name: string) { let id = ids.get(name); if (id === undefined) { id = ids.size; ids.set(name, id); } return id; }
const ID_A = ["a", "b"].map(idOf);
log.push("ids " + ids.size);
const ID_B = ["c", "a"].map(idOf);
log.push(JSON.stringify([ID_A, ID_B, [...ids]]));
console.log(log.join("\n"));
