// Whoever can tell two objects apart counts them here: ===, a Set, a Map, a WeakMap.
function keptInInnerLoop(turns) {
    const kept = new Set();
    let sum = 0;
    for (let i = 0; i < turns; i++) {
        const pair = { left: i, right: i + 1 };
        for (let j = 0; j < 4; j++) {
            if (((i + j) & 1) === 0)
                kept.add(pair);
            sum += pair.left + j;
        }
    }
    return kept.size + " " + sum;
}

function keptInOneTurnInFour(turns) {
    const kept = new Set();
    let sum = 0;
    for (let i = 0; i < turns; i++) {
        const pair = { left: i, right: i + 1 };
        if ((i & 3) === 0)
            kept.add(pair);
        sum += pair.left + pair.right;
    }
    let held = 0;
    for (const pair of kept)
        held += pair.right;
    return kept.size + " " + sum + " " + held;
}

function handedOverTwice(flag, take) {
    const pair = { left: 1, right: 2 };
    if (flag)
        return take(pair, pair);
    return "none";
}

function keptOnTwoWaysThatMeet(first, second, box) {
    const item = { n: 1 };
    if (first)
        box.first = item;
    if (second)
        box.second = item;
    return box.first === box.second;
}

function keptAndHandedBack(flag, seen) {
    const item = [flag];
    if (flag)
        seen.set(item, "kept");
    else
        return null;
    return item;
}

function comparedWithWhatWasKept(flag, holder) {
    const item = { n: 2 };
    if (flag) {
        holder.item = item;
        return holder.item === item;
    }
    return false;
}

function listedByAnother(flag, take) {
    const inner = { n: 1 };
    const outer = { inner, twice: [inner, inner] };
    if (flag)
        return take(outer, inner);
    return "none";
}

function lastCandidateLeavesTheLoop(list, fits) {
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
        const candidate = { at: i, value: list[i] };
        if (fits(candidate.value)) {
            seen.add(candidate);
            seen.add(candidate);
            return seen.size + " " + candidate.at;
        }
    }
    return "none";
}

console.log(keptInInnerLoop(100));
console.log(keptInOneTurnInFour(100));
console.log(handedOverTwice(true, (a, b) => a === b), handedOverTwice(false, () => 0));
console.log(keptOnTwoWaysThatMeet(true, true, {}), keptOnTwoWaysThatMeet(true, false, {}), keptOnTwoWaysThatMeet(false, false, {}));
const seen = new Map();
const back = keptAndHandedBack(true, seen);
console.log(seen.get(back), seen.size, keptAndHandedBack(false, seen), seen.size);
console.log(comparedWithWhatWasKept(true, {}), comparedWithWhatWasKept(false, {}));
const weak = new WeakMap();
let found = 0;
for (let i = 0; i < 50; i++) {
    const key = { i };
    if (i % 5 === 0)
        weak.set(key, i);
    if (weak.has(key))
        found += weak.get(key);
}
console.log(found);
console.log(listedByAnother(true, (outer, inner) => outer.inner === inner && outer.twice[0] === inner && outer.twice[1] === inner), listedByAnother(false, () => 0));
console.log(lastCandidateLeavesTheLoop([1, 2, 3, 4], value => value > 2), lastCandidateLeavesTheLoop([1], value => value > 2));
