// what Object.create() makes below an object with a `then` is awaited in a loop
const log = [];
const above = {
    then(resolve) {
        log.push("then from above, x is " + this.x);
        resolve(this.x * 100);
    },
};
function deed(x) {
    const made = Object.create(above);
    made.x = x;
    return made;
}
async function wait(turns) {
    let sum = 0;
    for (let i = 1; i <= turns; i++) {
        sum += await deed(i);
        log.push("turn " + i + " " + sum);
    }
    return sum;
}
log.push(String(await wait(3)));
console.log(log.join("\n"));
