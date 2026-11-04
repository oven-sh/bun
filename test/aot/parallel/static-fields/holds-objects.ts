class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
function push(times: number) { for (let i = 0; i < times; i++) { Meter.list = [...Meter.list, i]; } return Meter.list.join(); }
console.log(push(5)); Bun.gc(true); console.log(push(2), Meter.list.length);
export {};
