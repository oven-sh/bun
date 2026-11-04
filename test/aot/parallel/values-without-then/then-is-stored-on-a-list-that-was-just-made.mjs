// a `then` is stored on a list between its making and its await
const log = [];
async function plain(turns) {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
        const held = await [i, i + 1];
        sum += held[1];
    }
    return sum;
}
async function deed(turns) {
    let text = "";
    for (let i = 0; i < turns; i++) {
        const list = [i, i + 1];
        if (i & 1)
            list.then = resolve => { log.push("then of list " + i); resolve("no list"); };
        const held = await list;
        text += (held === list ? "list" : held) + ";";
    }
    return text;
}
log.push(String(await plain(3)));
log.push(await deed(4));
log.push(String(await plain(2)));
console.log(log.join("\n"));
