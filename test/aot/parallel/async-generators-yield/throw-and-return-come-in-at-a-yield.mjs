// throw() and return() come in while an async generator stands at a yield: before the first step, in the middle, behind the end, and three at once
const log = [];
async function* subject(name) {
    try {
        yield name + " 1";
        yield name + " 2";
        yield name + " 3";
    } finally {
        log.push(name + " cleans up");
    }
}
async function tell(name, step) {
    try {
        const given = await step;
        log.push(name + (given.done ? " done " : " value ") + given.value);
    } catch (error) {
        log.push(name + " throws " + error);
    }
}
async function deed(name, method, stepsInFront) {
    const made = subject(name);
    for (let i = 0; i < stepsInFront; i++)
        await tell(name, made.next());
    await tell(name, made[method]("by " + method));
    await tell(name, made.next());
}
for (let stepsInFront = 0; stepsInFront <= 4; stepsInFront += 2) {
    await deed("t" + stepsInFront, "throw", stepsInFront);
    await deed("r" + stepsInFront, "return", stepsInFront);
}
const busy = subject("busy");
const all = [tell("busy", busy.next()), tell("busy", busy.return("early")), tell("busy", busy.next())];
for (let i = 0; i < all.length; i++)
    await all[i];
console.log(log.join("\n"));
