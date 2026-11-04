// a `then` is stored on the prototype object of a class whose instances a loop awaits
const log = [];
class Point {
    constructor(x) {
        this.x = x;
    }
}
async function wait(turns) {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
        const held = await new Point(i);
        sum += typeof held === "number" ? held : held.x;
        log.push("turn " + i + " " + sum);
    }
    return sum;
}
function deed() {
    Point.prototype.then = function (resolve) {
        log.push("then of point " + this.x);
        resolve(this.x * 100);
    };
}
log.push(String(await wait(3)));
const waiting = wait(4);
await null;
deed();
log.push(String(await waiting));
log.push(String(await wait(2)));
console.log(log.join("\n"));
