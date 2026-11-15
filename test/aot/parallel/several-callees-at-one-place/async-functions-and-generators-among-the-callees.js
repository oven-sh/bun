// A plain function, an async function, a generator and an async arrow at one call.
function plain(x) { return x + 1; }
async function later(x) { return x + 2; }
function* stepped(x) { yield x + 3; yield x + 4; }
const laterArrow = async (x) => (await x) + 5;

const log = [];
for (let i = 0; i < 8; i++) {
    const place = i % 4;
    const f = place === 0 ? plain : place === 1 ? later : place === 2 ? stepped : laterArrow;
    const given = f(i);
    if (typeof given === "number")
        log.push(given);
    else if (typeof given.next === "function")
        log.push(...given);
    else
        log.push(await given);
    const waited = i & 1 ? later : laterArrow;
    log.push(await waited(i));
    const walked = i & 1 ? stepped : plain;
    const steps = walked(i);
    log.push(typeof steps === "number" ? steps : [...steps].length);
}
console.log(log.join());
