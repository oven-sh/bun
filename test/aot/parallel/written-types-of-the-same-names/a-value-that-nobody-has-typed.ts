interface On { state: "on"; level: number }
interface Off { state: "off"; level: number }

const parsed: any = JSON.parse('{"state":"dim","level":"high"}');
function on(): On { return { state: parsed.state, level: parsed.level }; }
function off(level: number): Off { return { state: "off", level }; }
function read(item: On | Off): string { return item.state + ":" + item.level + ":" + typeof item.level; }
let text = "";
for (let turn = 0; turn < 300; turn++) text = read(on()) + " " + read(off(turn));
console.log(text);
