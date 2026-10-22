// Species: programs w promise all calls overridden resolve. It prints what plain Bun prints.
const log: string[] = [];
class Sub<T> extends Promise<T> { static resolve(value?: any): any { log.push("resolve " + typeof value); return super.resolve(value); } }
Sub.all(["s", 1]).then(values => { log.push(String(values.length)); console.log(log.join("; ")); });
