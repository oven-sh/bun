// Generators that are walked where a loop steps them by hand, beside reads, sums and stores over objects that no layout of the file describes.
// Under: --aot-testing=FailSpeculations: guesses that fail
// Under: --aot-harden=proof-checks: proofs that are checked
// Under: --aot-erase-types: types that say nothing
function* heard(limit) {
    let sum = 0;
    for (let i = 0; i < limit; i++)
        sum += (yield sum + i) ?? 1;
    return sum;
}

function* marks(limit) {
    let given = 0;
    while (given < limit) {
        given = given + 1;
        yield "mark";
    }
}

function gather(held) {
    const swap = (other) => {
        held = other;
    };
    const it = marks(3);
    let text = "";
    for (let step = it.next(held.count++); !step.done; step = it.next(held.count++)) {
        held.weight += held.count;
        text += step.value;
    }
    if (text.length > 99)
        swap(null);
    return text + held.count + " " + held.weight;
}
console.log(gather(JSON.parse('{"count":5,"weight":0.5}')));
console.log(gather(JSON.parse('{"weight":"w","count":4}')));

function play(held, rounds) {
    const swap = (other) => {
        held = other;
    };
    let text = "";
    for (let round = 0; round < rounds; round++) {
        const it = heard(3);
        let step, sum = 0;
        while (!(step = it.next(held.factor * 2 + held.weight)).done) {
            sum += step.value;
            held.seen = sum;
        }
        text += sum + "/" + step.value + " ";
    }
    if (text === "")
        swap({});
    return text + held.seen;
}
console.log(play(JSON.parse('{"factor":3,"weight":2}'), 4));
console.log(play(JSON.parse('{"weight":0.5,"factor":1.25,"seen":0}'), 2));
console.log(play(JSON.parse('{"weight":"2","factor":3}'), 2));

function leave(list) {
    let total = 0;
    for (let round = 0; round < list.length; round++) {
        const it = heard(round + 1);
        const held = list[round];
        while (true) {
            held.level = held.amount * held.share + held.level;
            const step = it.next(held.level - held.amount);
            if (step.done)
                break;
            total += step.value * held.share + held.level;
        }
        total += held.level * held.amount;
    }
    return total;
}
console.log(leave(JSON.parse('[{"level":1,"amount":2,"share":3},{"amount":1,"level":0,"share":2},{"level":1,"amount":2.5,"share":0.5}]')));
console.log(leave(JSON.parse('[{"level":1,"amount":2,"share":3},{"level":2,"amount":"2","share":1}]')));

function inRow(holder, rounds) {
    let text = "";
    for (let round = 0; round < rounds; round++) {
        const held = holder.of(round);
        const it = heard(4);
        held.level += held.amount * held.share;
        const first = it.next(held.amount * 2 + held.level);
        held.level -= held.amount;
        const second = it.next(held.level * held.share - held.amount);
        text += first.value + held.level * held.amount + ":" + second.value + ":" + it.next(held.amount + held.share).value + " ";
    }
    return text;
}
const holder = {
    all: JSON.parse('[{"level":1,"amount":2,"share":3},{"amount":1,"level":0.5,"share":2}]'),
    of(round) {
        return this.all[round & 1];
    },
};
console.log(inRow(holder, 4), JSON.stringify(holder.all));
