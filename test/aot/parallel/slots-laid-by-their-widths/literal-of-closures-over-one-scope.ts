function makeCounter(start: number) {
    let total = start;
    let calls = 0;
    return {
        add: () => { calls++; total += 3; return total; },
        addTwice: () => { calls++; total += 6; return total; },
        calls: () => calls,
        clear: () => { calls++; total = 0; return total; },
        double: () => { calls++; total *= 2; return total; },
        halve: () => { calls++; total /= 2; return total; },
        isEven: () => total % 2 === 0,
        negate: () => { calls++; total = -total; return total; },
        read: () => total,
        reset: () => { calls++; total = start; return total; },
        square: () => { calls++; total *= total; return total; },
        subtract: () => { calls++; total -= 3; return total; },
        name: "counter",
        x: 1.5,
        y: 2.5,
    };
}

type Counter = ReturnType<typeof makeCounter>;

function collect(): void {
    let garbage: Counter[] = [];
    for (let i = 0; i < 500; i++)
        garbage.push(makeCounter(i));
    garbage = [];
    Bun.gc(true);
}

function show(counter: Counter): string {
    return counter.name + " " + String(counter.read()) + " " + String(counter.calls()) + " " + String(counter.isEven()) + " " + String(counter.x) + " " + String(counter.y);
}

const first = makeCounter(10);
const second = makeCounter(100);
collect();
console.log("made", show(first), "//", show(second));
console.log("add", String(first.add()), String(first.add()), String(second.add()));
collect();
console.log("double", String(first.double()), String(second.double()));
console.log("shown", show(first), "//", show(second));
console.log("one closure", String(first.add === first.add), String(first.add === second.add), String(first.halve === first.halve));
collect();
console.log("halve", String(first.halve()), String(second.halve()));
console.log("typeof", typeof first.square, typeof first.negate, typeof first.name, typeof first.x);
console.log("keys", Object.keys(first).join(","));

const kept = first.subtract;
collect();
console.log("kept", String(kept()), String(first.read()), String(kept === first.subtract));

const untouched = makeCounter(7);
collect();
const copy = { ...untouched };
console.log("copy", show(copy), String(copy.add === untouched.add), String(copy.add()), String(untouched.read()));
const assigned = Object.assign({}, makeCounter(8));
collect();
console.log("assigned", show(assigned), String(assigned.square()), Object.keys(assigned).join(","));
console.log("json", JSON.stringify(makeCounter(9)));

const walked: string[] = [];
const toWalk = makeCounter(5);
for (const key in toWalk)
    walked.push(key + ":" + typeof toWalk[key as keyof Counter]);
console.log("walked", walked.join(" "));
console.log("walked", show(toWalk), String(toWalk.negate()));

const changed = makeCounter(20);
(changed as any).add = () => -1;
(changed as any).double = "no closure";
(changed as any).x = "no number";
collect();
console.log("changed", String(changed.add()), String(changed.double), String(changed.x), String(changed.read()), String(changed.subtract()), String(changed.y));
delete (changed as any).halve;
delete (changed as any).name;
console.log("deleted", typeof changed.halve, typeof changed.name, String(changed.square()), Object.keys(changed).join(","));
(changed as any).halve = () => 0.5;
console.log("stored again", String(changed.halve()), Object.keys(changed).join(","));

const many: Counter[] = [];
for (let i = 0; i < 300; i++) {
    many.push(makeCounter(i));
    if (i % 100 === 99)
        collect();
}
let sum = 0;
for (let i = 0; i < many.length; i++) {
    const counter = many[i];
    if (i % 3 === 0)
        counter.add();
    if (i % 5 === 0)
        counter.double();
    sum += counter.read() + counter.calls() + counter.x + counter.y;
}
collect();
for (const counter of many)
    sum += counter.subtract() + counter.negate();
console.log("sum", String(sum));
