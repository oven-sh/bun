// An object, a list and a closure made in front of a loop are needed in one turn in four: a Set counts how many there are.
function collect(count) {
    const shared = { hits: 0 };
    const seen = new Set();
    for (let i = 0; i < count; i++) {
        if ((i & 3) === 0)
            seen.add(shared);
    }
    return seen.size;
}
function collectLists(count) {
    const shared = [count];
    const seen = new Set();
    for (let i = 0; i < count; i++) {
        if ((i & 3) === 0)
            seen.add(shared);
    }
    return seen.size;
}
function collectClosures(count) {
    const shared = () => count;
    const seen = new Set();
    for (let i = 0; i < count; i++) {
        if ((i & 3) === 0)
            seen.add(shared);
    }
    return seen.size;
}
const ways = { collect, collectLists, collectClosures };
for (const name of Object.keys(ways)) {
    for (const count of [0, 1, 40, 80])
        console.log(name, ways[name](count));
}
