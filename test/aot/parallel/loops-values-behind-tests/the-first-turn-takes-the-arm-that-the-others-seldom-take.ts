// Loops whose first turn takes the arm that the others seldom take, around reads that do not change from turn to turn.
class Message {
    id: number;
    declare retries: number;
    constructor(id: number) { this.id = id; }
}
Message.prototype.retries = 3;

function everyThousandth(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const message = new Message(i);
        if ((i & 1023) === 0) message.retries = 5;
        s += message.retries;
    }
    return s;
}

function firstAlone(list: number[], config: { scale: number }): number {
    let s = 0;
    for (let i = 0; i < list.length; i++) {
        if (i === 0) { s += 100; continue; }
        s += config.scale * list[i];
    }
    return s;
}

function allButTheFirst(list: string[], config: { separator: string }): string {
    let s = "";
    for (let i = 0; i < list.length; i++) {
        if (i > 0) s += config.separator;
        s += list[i];
    }
    return s;
}

function everyOther(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const message = new Message(i);
        if ((i & 1) === 0) message.retries = 7;
        s += message.retries;
    }
    return s;
}

// The default changes while the loop runs, in the rare arm and outside of it.
function defaultChangesInTheRareArm(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const message = new Message(i);
        if ((i & 255) === 0) Message.prototype.retries = (i >> 8) + 1;
        s += message.retries;
    }
    Message.prototype.retries = 3;
    return s;
}

function defaultBecomesAGetter(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const message = new Message(i);
        if (i === 700) Object.defineProperty(Message.prototype, "retries", { get() { return this.id & 3; }, configurable: true });
        if ((i & 511) === 0) s += 1000;
        else s += message.retries;
    }
    Object.defineProperty(Message.prototype, "retries", { value: 3, writable: true, configurable: true, enumerable: true });
    return s;
}

function defaultIsDeleted(n: number): string {
    let s = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        const message = new Message(i);
        if (i === 900) delete (Message.prototype as any).retries;
        if ((i & 127) === 0) continue;
        const r = message.retries;
        if (r === undefined) missing++;
        else s += r;
    }
    Message.prototype.retries = 3;
    return s + "," + missing;
}

function startsLater(from: number, n: number): number {
    let s = 0;
    for (let i = from; i < n; i++) {
        const message = new Message(i);
        if ((i & 1023) === 0) message.retries = 5;
        s += message.retries;
    }
    return s;
}

function neverTakesTheCommonArm(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i += 1024) {
        const message = new Message(i);
        if ((i & 1023) === 0) message.retries = 5;
        s += message.retries;
    }
    return s;
}

const numbers = Array.from({ length: 3000 }, (_, i) => i % 17);
const words = Array.from({ length: 40 }, (_, i) => "w" + i);
for (let round = 0; round < 3; round++) {
    console.log(everyThousandth(5000), everyThousandth(0), everyThousandth(1), everyThousandth(2), everyThousandth(1025.5));
    console.log(firstAlone(numbers, { scale: 3 }), firstAlone([], { scale: 3 }), firstAlone([9], { scale: 3 }), firstAlone([9, 8], { scale: 3 }));
    console.log(allButTheFirst(words, { separator: ", " }), allButTheFirst([], { separator: "-" }), allButTheFirst(["a"], { separator: "-" }));
    console.log(everyOther(5001));
    console.log(defaultChangesInTheRareArm(3000));
    console.log(defaultBecomesAGetter(3000));
    console.log(defaultIsDeleted(3000));
    console.log(startsLater(1, 5000), startsLater(1024, 5000), startsLater(1023, 1026), startsLater(7, 3));
    console.log(neverTakesTheCommonArm(50000));
}
