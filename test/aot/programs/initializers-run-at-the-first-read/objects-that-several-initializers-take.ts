// One object that several initializers take: identity, order of filling, and a taker that stays.
const log: string[] = [];
function make() { return { items: [] as number[] }; }
const A = (() => { const shared = { n: 1 }; return [{ s: shared }, { s: shared }] as const; })();
log.push(String(A[0].s === A[1].s));

const BASE = ["x", "y"];
const FIRST = { list: BASE };
const SECOND = { list: BASE };
const THIRD = BASE.map(s => s + s);
log.push(String(FIRST.list === SECOND.list) + " " + THIRD);
FIRST.list.push("z");
log.push(SECOND.list.join() + " " + THIRD);

const [P, Q] = [make(), make()];
P.items.push(1);
log.push(JSON.stringify([P, Q, P === Q]));

const TABLE = [[1, 2], [3, 4]];
const ROW = TABLE[1];
const FLAT = TABLE.flatMap(r => r);
const SUMS = TABLE.map(r => r[0] + r[1]);
ROW[0] = 30;
log.push(JSON.stringify([TABLE, ROW, FLAT, SUMS, ROW === TABLE[1]]));

const NESTED = { inner: { deep: [1] } };
const { inner } = NESTED;
const { deep } = inner;
const COPY = { ...inner };
log.push(String(deep === NESTED.inner.deep) + String(COPY.deep === deep) + String(COPY === inner));

console.log(BASE.length, log.join("\n"));
