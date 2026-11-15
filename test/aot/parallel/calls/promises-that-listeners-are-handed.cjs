// The host hands a promise that is rejected to the listeners, and they lay names on it.
"use strict";
class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}
const out = [];
const event = process.argv.length > 60 ? "exit" : "unhandledRejection";
process.on(event, function (reason) {
    const promise = arguments[1];
    out.push(`heard ${reason.message}`);
    if (reason.message === "then")
        promise.then = fulfilled => fulfilled(new Point(1, 2));
    if (reason.message === "catch")
        promise.catch = () => "own catch";
    if (reason.message === "prototype")
        Object.setPrototypeOf(promise, { then: 5, finally: () => "own finally" });
});
process.on("rejectionHandled", promise => out.push(`handled ${typeof promise.then}`));
const wait = () => new Promise(resolve => setTimeout(resolve, 1));
(async () => {
    const list = ["then", "catch", "prototype", "plain"].map(async message => {
        throw new Error(message);
    });
    const held = new Promise((resolve, reject) => reject(new Error("then")));
    await wait();
    await wait();
    list[0].then(point => out.push(`own then ${point.x}`));
    held.then(point => out.push(`held ${point.y}`));
    out.push(list[1].catch(() => {}));
    out.push(list[2].finally(), typeof list[2].then);
    try {
        await list[3];
    } catch (error) {
        out.push(`caught ${error.message}`);
    }
    try {
        out.push(`awaited ${(await list[1]).x}`);
    } catch (error) {
        out.push(`caught ${error.message}`);
    }
    await wait();
    console.log(out.join("\n"));
})();
