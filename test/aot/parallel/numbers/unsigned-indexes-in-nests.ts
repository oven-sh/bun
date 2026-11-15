// An index that is cut to an unsigned or signed word, of numbers that are no words, in a loop in a loop.
const said: string[] = [];
const say = (x: any) => void said.push(Object.is(x, -0) ? "-0" : String(x));
const view = new Int32Array([7, -6, 5, -4, 3, -2, 1, 9]);
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const doubles = new Float64Array([0.5, -0, 2.5, NaN, 4.5, 5, 6, 7]);
const list: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
function ofView(y: number): any { return view[y >>> 0]; }
function ofBytes(y: number): any { return bytes[y >>> 0]; }
function ofDoubles(y: number): any { return doubles[y >>> 0]; }
function ofList(y: number): any { return list[y >>> 0]; }
function signed(y: number): any { return view[y | 0]; }
function negated(y: number): any { return view[-y >>> 0]; }
function shifted(y: number): any { return view[y >>> 29]; }
function store(y: number, x: number): void { bytes[y >>> 0] = x; }
function update(y: number): void { view[y >>> 0] += 3; }
function runView(y: number) { for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) say(ofView(y - i)); }
function runBytes(y: number) { for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) say(ofBytes(y - i)); }
function runDoubles(y: number) { for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) say(ofDoubles(y - i)); }
function runList(y: number) { for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) say(ofList(y - i)); }
function runSigned(y: number) { for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) say(signed(y - i)); }
function runNegated(y: number) { for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) say(negated(y - i)); }
function runShifted(y: number) { for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) say(shifted(y - i)); }
function runStore(y: number) { for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) store(y - i, i + j); }
function runUpdate(y: number) { for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) update(y - i); }
said.push("View");
runView(2 ** 31); runView(2 ** 52); runView(2 ** 32 + 5); runView(2 ** 40 + 3);
said.push("Bytes");
runBytes(2 ** 31); runBytes(2 ** 52); runBytes(2 ** 32 + 5); runBytes(2 ** 40 + 3);
said.push("Doubles");
runDoubles(2 ** 31); runDoubles(2 ** 52); runDoubles(2 ** 32 + 5); runDoubles(2 ** 40 + 3);
said.push("List");
runList(2 ** 31); runList(2 ** 52); runList(2 ** 32 + 5); runList(2 ** 40 + 3);
said.push("Signed");
runSigned(2 ** 31); runSigned(2 ** 52); runSigned(2 ** 32 + 5); runSigned(2 ** 40 + 3);
said.push("Negated");
runNegated(2 ** 31); runNegated(2 ** 52); runNegated(2 ** 32 + 5); runNegated(2 ** 40 + 3);
said.push("Shifted");
runShifted(2 ** 31); runShifted(2 ** 52); runShifted(2 ** 32 + 5); runShifted(2 ** 40 + 3);
said.push("Store");
runStore(2 ** 31); runStore(2 ** 52); runStore(2 ** 32 + 5); runStore(2 ** 40 + 3);
said.push("Update");
runUpdate(2 ** 31); runUpdate(2 ** 52); runUpdate(2 ** 32 + 5); runUpdate(2 ** 40 + 3);
said.push(view.join(), bytes.join());
console.log(said.join(" "));
