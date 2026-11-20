"use strict";
// Inner loops whose calls only read, inside the versions of the loops around: receivers of several classes, and rows that change while a nest runs.
class Sheet {
    constructor(lines) {
        this.lines = lines;
        this.tall = lines.length;
        this.broad = lines.length ? lines[0].length : 0;
    }

    at(line, place) {
        return this.lines[line][place];
    }

    total() {
        let total = 0;
        for (let line = 0; line < this.tall; line++) {
            for (let place = 0; place < this.broad; place++)
                total += this.at(line, place);
        }
        return total;
    }

    likeness(other) {
        let best = -1;
        let name = "none";
        for (let mine = 0; mine < this.tall; mine++) {
            for (let theirs = 0; theirs < other.tall; theirs++) {
                let common = 0;
                for (let place = 0; place < this.broad; place++)
                    common += Math.min(this.at(mine, place), other.at(theirs, place));
                if (common > best) {
                    best = common;
                    name = mine + "~" + theirs;
                }
            }
        }
        return name + "=" + best;
    }

    widest(watch) {
        let widest = 0;
        for (let line = 0; line < this.tall; line++) {
            let low = Infinity, high = -Infinity;
            for (let place = 0; place < this.broad; place++) {
                const value = this.at(line, place);
                low = value < low ? value : low;
                high = value > high ? value : high;
            }
            if (watch)
                watch(this, line);
            widest += high - low;
        }
        return widest;
    }
}
class Turned extends Sheet {
    at(line, place) {
        return this.lines[place][line];
    }
}
class Scaled extends Sheet {
    constructor(lines, by) {
        super(lines);
        this.by = by;
    }

    at(line, place) {
        return super.at(line, place) * this.by;
    }
}

const make = (tall, broad, of) => Array.from({ length: tall }, (_, line) => Array.from({ length: broad }, (__, place) => of(line, place)));
const sheets = {
    waves: new Sheet(make(6, 10, (line, place) => Math.cos(line + place / 3))),
    counts: new Sheet(make(7, 10, (line, place) => (line * 3 + place * place) % 8)),
    turned: new Turned(make(8, 8, (line, place) => line * 0.5 - place)),
    scaled: new Scaled(make(5, 10, (line, place) => line ^ place), 0.25),
    own: Object.assign(new Sheet(make(4, 10, (line, place) => line + place)), { at(line, place) { return line * 100 + place; } }),
    views: new Sheet(make(4, 1, () => 0).map((_, line) => Float64Array.from({ length: 10 }, (__, place) => line / (place + 1)))),
    texts: new Sheet(make(3, 10, (line, place) => (place === 4 ? "4" : line))),
};
const said = value => (typeof value === "number" ? value.toFixed(4) : typeof value + " " + value);
for (let round = 0; round < 3; round++) {
    for (const [name, sheet] of Object.entries(sheets)) {
        console.log(round, name, said(sheet.total()), said(sheet.widest(null)));
        for (const [other, beside] of Object.entries(sheets)) {
            let line;
            try {
                line = sheet.likeness(beside);
            } catch (error) {
                line = error.constructor.name;
            }
            console.log("   ", other, line);
        }
    }
}
const changes = {
    swapped: (sheet, line) => { if (line === 2) sheet.lines[3] = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]; },
    shorter: (sheet, line) => { if (line === 1) sheet.lines[4].length = 3; },
    broader: (sheet, line) => { if (line === 3) sheet.broad = 12; },
    redefined: (sheet, line) => { if (line === 2) sheet.at = (at, place) => at - place; },
    texts: (sheet, line) => { if (line === 0) sheet.lines[5][2] = "17"; },
    frozen: (sheet, line) => { if (line === 1) Object.freeze(sheet.lines); },
};
for (const [name, change] of Object.entries(changes)) {
    const sheet = new Sheet(make(6, 10, (line, place) => (line + 1) * (place - 4)));
    let line;
    try {
        line = said(sheet.widest(change)) + " then " + said(sheet.widest(null));
    } catch (error) {
        line = error.constructor.name;
    }
    console.log(name, line, said(sheet.total()));
}
