// Unions of an object type with an array, a promise or a Map.
declare const console: { log(...values: unknown[]): void };
type Mine = { mine: number };
type Other = { other: string };
type Third = { third: boolean };
type Listed = Mine | Other[];
type Later = Other | Promise<Mine>;
type Keyed = Third | Map<string, Mine>;
function listed(e: Listed): string {
  return Array.isArray(e) ? 'list ' + e.length + ' ' + e[0].other : 'mine ' + e.mine;
}
async function later(e: Later): Promise<string> {
  return e instanceof Promise ? 'later ' + (await e).mine : 'other ' + e.other;
}
function keyed(e: Keyed): string {
  return e instanceof Map ? 'keyed ' + e.get('k')!.mine : 'third ' + e.third;
}
console.log(listed({ mine: 1 }), listed([{ other: 'o' }]), keyed({ third: true }), keyed(new Map([['k', { mine: 2 }]])));
later({ other: 'p' }).then(a => later(Promise.resolve({ mine: 3 })).then(b => console.log(a, b)));
type Row = { x: string };
const parsed = JSON.parse('[{"x":"s"}]') as Row[];
const promised: Promise<Row> = Promise.resolve(parsed[0]);
const mapped: Map<string, Row> = new Map([['r', parsed[0]]]);
promised.then(row => console.log(row.x, mapped.get('r')!.x, parsed.length));
