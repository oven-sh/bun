// Methods of several classes give what a step written by hand sends, behind a store into a view.
// Under: --aot-testing=FailSpeculations: guesses that fail
// Under: --aot-harden=proof-checks: proofs that are checked
function* counts(limit: any): Generator<number, number, any> {
    let heard = 0;
    for (let i = 0; i < limit; i++)
        heard += Number(yield heard) || 1;
    return heard;
}

class Circle {
    pick(a: any, b: any) {
        return a;
    }
    id() {
        return 1;
    }
}
class Square {
    pick(a: any, b: any) {
        return b;
    }
    id() {
        return 2;
    }
}
class Line {
    a: any;
    pick(a: any, b: any) {
        return this.a ?? a + b;
    }
    id() {
        return 3;
    }
}

function behindStores(shape: any, rounds: number) {
    const view = new Int32Array([1, 2, 3, 4]);
    const line: any[] = [];
    for (let round = 0; round < rounds; round++) {
        const it = counts(round);
        let step = it.next(shape.pick(5, 6) * 2);
        while (!step.done) {
            line.push(step.value);
            view[0] += shape.id();
            step = it.next(shape.pick(1, 2));
        }
    }
    return line.join() + "|" + view.join();
}

function behindCounts(shape: any, rounds: number) {
    const view = new Float64Array(4);
    let text = "";
    for (let round = 0; round < rounds; round++) {
        const it = counts(round + 1);
        for (let step = it.next(0); !step.done; step = it.next(shape.pick(round, 7))) {
            text += step.value + " ";
            view[shape.id() & 3] += shape.id() * 0.5;
        }
    }
    return text + view.join();
}

for (const shape of [new Circle(), new Square()])
    console.log(behindStores(shape, 4), behindCounts(shape, 3));
for (const shape of [new Circle(), new Square(), new Line()])
    console.log(behindStores(shape, 3), behindCounts(shape, 2));
