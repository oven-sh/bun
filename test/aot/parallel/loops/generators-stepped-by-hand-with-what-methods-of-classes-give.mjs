// What a step written by hand sends is found by methods of several classes.
// Under: --aot-testing=FailSpeculations: guesses that fail
// Under: --aot-harden=proof-checks: proofs that are checked
// Under: --aot-erase-types: types that say nothing
function* heard(limit) {
    let last = 0;
    while (limit-- > 0)
        last = yield last;
    return last;
}

function* three() {
    const a = yield 1;
    const b = yield a;
    const c = yield b;
    return [a, b, c].join();
}

class Circle {
    constructor(size) {
        this.size = size;
    }
    area(k) {
        return this.size * k;
    }
    id() {
        return 1;
    }
}
class Square {
    n = 0;
    constructor(side) {
        this.side = side;
    }
    area(k) {
        this.n++;
        return this.side * this.side + k;
    }
    id() {
        return 2;
    }
}
class Line {
    area(k) {
        return k;
    }
    id() {
        return 3;
    }
}

function inCondition(shape, rounds) {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        const it = heard(3);
        let step;
        while (!(step = it.next(shape.id())).done)
            total = total * 10 + step.value;
        total += step.value * 1000;
    }
    return total;
}

function inBody(shape, rounds) {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        const it = heard(round + 1);
        while (true) {
            total += shape.id();
            const step = it.next(shape.area(round) + shape.id());
            if (step.done)
                break;
            total += step.value * shape.id();
        }
    }
    return total;
}

function inHead(shape, rounds) {
    let text = "";
    for (let round = 0; round < rounds; round++) {
        const it = heard(3);
        for (let step = it.next(shape.id()); !step.done; step = it.next(shape.area(step.value)))
            text += step.value + " ";
    }
    return text;
}

function inRow(list, shape) {
    let text = "";
    for (let round = 0; round < 4; round++) {
        const held = list[round & 1];
        const it = three();
        held.seen = it.next(shape.id()).value;
        text += shape.id() + ":" + held.seen + ":";
        const second = it.next(shape.id() + shape.area(2));
        held.level = second.value;
        text += second.value + ":" + it.next(shape.area(held.level)).value + ":" + it.next(held.level * 2).value + " ";
    }
    return text + JSON.stringify(list);
}

for (const shape of [new Circle(2), new Square(3), new Line(), new Circle(1.5)]) {
    console.log(inCondition(shape, 3), inBody(shape, 3));
    console.log(inHead(shape, 2));
    console.log(inRow(JSON.parse('[{"level":1,"amount":2},{"amount":1,"level":0.5}]'), shape));
}
