// Species: programs w constructor getter. It prints what plain Bun prints.
const log: string[] = [];
class List extends Array<number> {}
class Later<T> extends Promise<T> {}
Object.defineProperty(List.prototype, "constructor", { get() { log.push("list constructor getter"); return Array; } });
Object.defineProperty(Later.prototype, "constructor", { get() { log.push("later constructor getter"); return Promise; } });
log.push(String(List.from([1]).map(one => one) instanceof List));
(async () => { log.push(String(await new Later<number>(resolve => resolve(1)))); console.log(log.join("; ")); })();
