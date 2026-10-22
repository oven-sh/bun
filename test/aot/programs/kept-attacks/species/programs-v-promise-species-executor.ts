// then() constructs the species of a promise subclass with a native executor; the constructor says its parameter is a string.
const log: string[] = [];
class Mine<T> extends Promise<T> { constructor(executor: any, label?: string) { super(typeof executor === "function" ? executor : () => {}); log.push("new " + typeof executor + " " + typeof label); } }
const first = new Mine<number>((resolve: (value: number) => void) => resolve(1), "mine");
const second = first.then(one => one + 1);
log.push(String(second instanceof Mine));
second.then(value => { log.push(String(value)); console.log(log.join("; ")); });
