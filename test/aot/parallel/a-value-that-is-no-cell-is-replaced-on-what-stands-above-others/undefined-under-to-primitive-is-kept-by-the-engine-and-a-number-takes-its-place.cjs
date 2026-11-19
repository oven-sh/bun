const rounds = Number(process.argv[2] || 1);
const make = () => { const made = JSON.parse('{"n":1}'); made[Symbol.toPrimitive] = undefined; return made; };
const above = make(), twin = make();
const heir = JSON.parse('{"m":2}'), heirOfTwin = JSON.parse('{"m":2}');
Object.setPrototypeOf(heir, above); Object.setPrototypeOf(heirOfTwin, twin);
function store(holder, value) { holder[Symbol.toPrimitive] = value; }
function ask(value) { try { return `${value}`.length; } catch (error) { return error.constructor.name; } }
for (let round = 0; round < rounds; round++) for (let turn = 0; turn < 40; turn++) store(twin, turn & 1 ? null : undefined);
const out = [ask(heir), ask(heir)];
store(above, 1); out.push(ask(heir));
store(above, null); out.push(ask(heir));
console.log("SAID " + out.join(" "));
