// an async function in which nothing suspends, written to return a number, returns a thenable, a promise and a getter that throws
const log: string[] = [];
async function double(value: number): Promise<number> {
    log.push("in double");
    return value;
}
function deed(kind: number): number {
    if (kind === 0)
        return { then(resolve: (value: number) => void) { log.push("then runs"); resolve(10); } } as any;
    if (kind === 1)
        return Promise.resolve(20) as any;
    if (kind === 2)
        return Object.defineProperty({}, "then", { get() { log.push("getter runs"); throw "thrown by then"; } }) as any;
    return kind;
}
async function ticks(turns: number) {
    for (let i = 0; i < turns; i++) {
        log.push("tick " + i);
        await undefined;
    }
}
const ticking = ticks(6);
for (let kind = 3; kind >= 0; kind--)
    double(deed(kind)).then(value => log.push("kind " + kind + " gives " + value), error => log.push("kind " + kind + " fails " + error));
log.push("behind the calls");
await ticking;
log.push(String(typeof double(1)) + " " + String(double(1) instanceof Promise));
log.push(String(await double(deed(0))));
console.log(log.join("\n"));
export {};
