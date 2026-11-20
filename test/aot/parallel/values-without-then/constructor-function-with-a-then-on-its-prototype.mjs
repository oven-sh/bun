// what a constructor function makes is awaited in a loop, and a statement has laid a `then` on its prototype object
const log = [];
function Later(x) {
    this.x = x;
}
function deed() {
    Later.prototype.then = function (resolve) {
        log.push("then of " + this.x);
        resolve(this.x * 100);
    };
}
async function wait(turns) {
    let sum = 0;
    for (let i = 1; i <= turns; i++) {
        const held = await new Later(i);
        sum += typeof held === "number" ? held : held.x;
        log.push("turn " + i + " " + sum);
    }
    return sum;
}
log.push(String(await wait(2)));
deed();
log.push(String(await wait(2)));
console.log(log.join("\n"));
