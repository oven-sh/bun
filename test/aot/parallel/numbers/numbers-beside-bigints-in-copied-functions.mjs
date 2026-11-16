// A function of unknown operands that is copied into loops: the same sums over numbers, over BigInts and over both.
function squaredDistance(p, q) {
    const dx = p.x - q.x, dy = p.y - q.y;
    return dx * dx + dy * dy;
}

function total(points, start) {
    let sum = start;
    for (let i = 0; i < points.length; i++)
        sum += squaredDistance(points[i], points[(i + 1) % points.length]);
    return sum;
}

function nearest(points, limit) {
    let best = limit, place = -1;
    for (let i = 0; i + 1 < points.length; i++) {
        const distance = squaredDistance(points[i], points[i + 1]);
        if (distance < best) {
            best = distance;
            place = i;
        }
    }
    return [best, place];
}

function remainders(points, modulus) {
    let last = points[0].x;
    for (const point of points)
        last = (squaredDistance(point, points[0]) * last + point.y) % modulus;
    return last;
}

function show(value) {
    return typeof value === "bigint" ? value + "n" : Array.isArray(value) ? value.map(show).join() : Object.is(value, -0) ? "-0" : String(value);
}

function attempt(call) {
    try {
        return show(call());
    } catch (error) {
        return error.name;
    }
}

const numbers = JSON.parse('[{"x":1,"y":2.5},{"x":3.5,"y":4},{"x":5,"y":-6}]');
const integers = JSON.parse('[{"x":1,"y":2},{"x":2000000000,"y":-4},{"x":5,"y":6}]');
const bigInts = [{ x: 1n, y: 2n }, { x: 10n ** 20n, y: -4n }, { x: 5n, y: 6n }];
const mixed = [{ x: 1, y: 2 }, { x: 3n, y: 4n }, { x: 5, y: 6 }];
const texts = [{ x: "4", y: "2" }, { x: null, y: true }, { x: { valueOf() { return 3; } }, y: { valueOf() { return 4n; } } }];

for (let turn = 0; turn < 40; turn++) {
    const lines = [];
    for (const points of [numbers, integers, bigInts, mixed, texts, numbers.slice(0, 1), bigInts.slice(1)]) {
        for (const start of [0, 0.5, 0n, "t", undefined])
            lines.push(attempt(() => total(points, start)));
        for (const limit of [1e9, 10n ** 9n, "7", NaN])
            lines.push(attempt(() => nearest(points, limit)));
        for (const modulus of [7, 2.5, 97n, "5"])
            lines.push(attempt(() => remainders(points, modulus)));
    }
    if (turn === 0 || turn === 39)
        console.log(lines.join("\n"));
}
