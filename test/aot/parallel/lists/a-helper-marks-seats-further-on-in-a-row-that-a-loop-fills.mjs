// A loop fills a row of seats one after another. A helper with a loop of its own marks seats further on, in the same row under another name or in another row.
class Hall {
    constructor(name) {
        this.name = name;
        this.row = [0];
        this.balconies = [[1], [2]];
        this.closed = new Map([["row", [5, 6]]]);
    }
}

function markFrom(row, seat, most) {
    for (let further = 0; further < most; further++)
        row[seat + further] |= most;
}

function fillBehindMarks(hall, again, source, count) {
    const row = [];
    hall.row = row;
    for (let seat = 0; seat < 8; seat++) {
        markFrom(again.row, seat, 3);
        row[seat] = (seat * 7) & 31;
    }
    return [row, []];
}

function turnOver(row, seat, most) {
    let further = 0;
    while (further < most) {
        row[seat + further] ^= 4;
        further++;
    }
}

function fillInFrontOfMarks(hall, again, source, count) {
    const row = [];
    const numbers = [];
    hall.balconies[0] = row;
    const other = again.balconies[0];
    for (let seat = 0; seat < 20; seat++) {
        row[seat] = count > 5 ? (seat * 5) & 15 : seat * .5;
        turnOver(other, seat, 3);
        numbers[seat] = seat;
    }
    numbers.push(row.length);
    return [row, numbers];
}

function markPairs(row, seat) {
    for (let further = 1; further < 3; further++) {
        row[further + seat] |= 4;
        row[further + seat + 1] |= 1;
    }
}

function fillBesidePairs(hall, again, source, count) {
    const row = [];
    const numbers = [];
    hall.balconies[0] = row;
    const other = again.balconies[0];
    for (let seat = 0; seat < 3; seat++) {
        row[seat] = count > 5 ? 0 : .5;
        markPairs(other, seat);
        numbers[seat] = seat;
    }
    numbers.push(row.length);
    return [row, numbers];
}

function markAll(row, seat, most) {
    for (let further = 1; further < most; further++)
        row[seat + further] |= further;
}

function fillChosen(hall, again, source, count) {
    const row = [];
    const numbers = [];
    let other = row;
    if (again !== hall)
        other = again.row;
    for (let seat = 0; seat <= 9; seat++) {
        row[seat] = count > 5 ? seat & 7 : seat * .5;
        markAll(other, seat, 5);
        numbers[seat] = seat;
    }
    numbers.push(row.length);
    return [row, numbers];
}

function nameFurther(row, seat, most) {
    let further = 0;
    while (further < most) {
        row[seat + further] |= seat;
        further++;
    }
}

function fillOfSource(hall, again, source, count) {
    const row = [];
    const numbers = [];
    hall.balconies[0] = row;
    const other = again.balconies[0];
    for (let seat = 0; seat < 7; seat++) {
        nameFurther(other, seat, 3);
        numbers.push(seat);
        row[seat] = source[seat] | 0;
    }
    numbers.push(row.length);
    return [row, numbers];
}

function turnPairs(row, seat) {
    for (let further = 0; further < 4; further++) {
        row[seat + further] ^= 1;
        row[seat + further + 1] ^= 1;
    }
}

const rows = [[], []];

function fillWithHalves(hall, again, source, count) {
    const row = [];
    const numbers = [];
    rows[0] = row;
    rows[1] = again.row;
    const other = rows[again === hall ? 0 : 1];
    for (let seat = 0; seat < 20; seat++) {
        turnPairs(other, seat);
        row[seat] = seat * .5;
        numbers[seat] = seat;
    }
    numbers.push(row.length);
    return [row, numbers];
}

function markOwn(row, seat, most) {
    for (let further = 0; further < most; further++)
        row[seat + further] |= most;
}

function fillItself(hall) {
    const row = [];
    hall.row = row;
    for (let seat = 0; seat < 7; seat++) {
        markOwn(row, seat + 1, 3);
        row[seat] = seat + 1;
    }
    return [row, []];
}

const fills = new Map(Object.entries({ fillBehindMarks, fillInFrontOfMarks, fillBesidePairs, fillChosen, fillOfSource, fillWithHalves, fillItself }));
const source = [3, 1, 4, 1, 5, 9, 2];
for (const name of fills.keys()) {
    for (const count of [9, 2]) {
        const halls = new Map([["first", new Hall("first")], ["second", new Hall("second")]]);
        for (const again of halls.values()) {
            const [row, numbers] = fills.get(name)(halls.get("first"), again, source, count);
            console.log(name, again.name, row.length, row.join(), numbers.join(), again.row.join(), again.balconies[0].join());
        }
    }
}
