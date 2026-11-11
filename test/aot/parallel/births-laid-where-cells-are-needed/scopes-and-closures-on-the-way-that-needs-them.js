// A scope whose only needs are the closures made over it, and a closure that one side of a branch alone hands out.
function firstAbove(list, limit) {
    if (list.length === 0)
        return -1;
    return list.findIndex(value => value > limit);
}

function reportsOnRareWay(value, report) {
    const describe = () => "value " + value;
    if (value < 0)
        report(describe);
    return value * 2;
}

function handedOverTwice(flag, take) {
    const work = () => 1;
    if (flag)
        return take(work, work);
    return false;
}

function keptInTurnsDroppedAtTheEnd(turns) {
    const listeners = new Set();
    let calls = 0;
    for (let i = 0; i < turns; i++) {
        const listener = () => i;
        if ((i & 1) === 0)
            listeners.add(listener);
        if ((i & 3) === 0)
            listeners.delete(listener);
        calls += listener();
    }
    return listeners.size + " " + calls;
}

function countsInScope(flag, keep) {
    let count = 0;
    const bump = () => ++count;
    count += 10;
    if (flag)
        keep(bump);
    count += 100;
    return count;
}

function namesItself(flag, take) {
    const self = function again(depth) { return depth ? again(depth - 1) : again; };
    if (flag)
        return take(self) === self;
    return null;
}

function constructsBeforeItIsHandedOut(flag, keep) {
    function Point(x) { this.x = x; }
    const point = new Point(3);
    if (flag)
        keep(Point);
    return point.x + " " + (Object.getPrototypeOf(point) !== Object.prototype) + " " + point.constructor.name;
}

const told = [];
console.log(firstAbove([], 1), firstAbove([1, 5, 9], 4), firstAbove([1], 4));
console.log(reportsOnRareWay(4, describe => told.push(describe())), reportsOnRareWay(-4, describe => told.push(describe())), told.join());
console.log(handedOverTwice(true, (a, b) => a === b), handedOverTwice(false, () => true));
console.log(keptInTurnsDroppedAtTheEnd(100));
let kept = null;
console.log(countsInScope(false, null), countsInScope(true, bump => { kept = bump; }), kept(), kept());
console.log(namesItself(true, self => self(3)), namesItself(false, null));
console.log(constructsBeforeItIsHandedOut(false, null), constructsBeforeItIsHandedOut(true, Point => { kept = Point; }), new kept(4) instanceof kept);
