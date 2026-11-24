"use strict";
// An array of rows read under a counter again and again: the checks count the rows that passed, and whatever may change a row makes them start over.
class Track {
    constructor(laps) {
        this.laps = laps;
        this.seen = 0;
    }

    nearest(to) {
        let nearest = -1;
        let least = Infinity;
        for (let lap = 0; lap < this.laps.length; lap++) {
            let apart = 0;
            for (let mark = 0; mark < to.length; mark++) {
                const gap = this.laps[lap][mark] - to[mark];
                apart += gap * gap;
            }
            if (apart < least) {
                least = apart;
                nearest = lap;
            }
        }
        return nearest + ":" + least.toFixed(6);
    }

    paces(times, between) {
        let pace = 0;
        for (let time = 0; time < times; time++) {
            for (let lap = 0; lap < this.laps.length; lap++) {
                for (let mark = 0; mark < this.laps[lap].length; mark++)
                    pace += this.laps[lap][mark] / (time + 1);
            }
            if (between !== null)
                between(this, time);
        }
        return pace;
    }

    crossings(step) {
        let crossings = 0;
        for (let lap = 1; lap < this.laps.length; lap++) {
            for (let mark = 0; mark < this.laps[0].length; mark += step) {
                if ((this.laps[lap][mark] > 0) !== (this.laps[lap - 1][mark] > 0))
                    crossings += this.laps[lap][mark] + 1;
            }
        }
        return crossings;
    }
}
const laps = (many, long, of) => Array.from({ length: many }, (_, lap) => Array.from({ length: long }, (__, mark) => of(lap, mark)));
const said = ask => {
    try {
        const value = ask();
        return typeof value === "number" ? value.toPrecision(9) : typeof value + " " + value;
    } catch (error) {
        return error.constructor.name;
    }
};
const tracks = {
    fractions: () => laps(10, 16, (lap, mark) => Math.sin(lap + mark * 0.7)),
    whole: () => laps(10, 16, (lap, mark) => (lap * 7 - mark * 3) % 9),
    mixed: () => laps(8, 12, (lap, mark) => (lap & 2 ? mark - 5 : mark / 3 - 1)),
    views: () => laps(6, 12, (lap, mark) => lap - mark / 2).map(row => Float64Array.from(row)),
    uneven: () => laps(6, 9, (lap, mark) => lap - mark).map((row, lap) => row.slice(0, 9 - lap)),
    holes: () => laps(4, 9, (lap, mark) => mark - 3.5).map((row, lap) => { if (lap === 2) delete row[4]; return row; }),
    texts: () => laps(4, 9, (lap, mark) => (lap === 3 && mark === 7 ? "5" : mark - lap)),
};
const between = {
    nothing: null,
    raises: (track, time) => { track.laps[time % track.laps.length][1] += 0.25; },
    replaces: (track, time) => { if (time === 2) track.laps[1] = [1, 2, 3]; },
    cuts: (track, time) => { if (time === 1) track.laps[0].length = 4; },
    grows: (track, time) => { if (time < 3) track.laps[2].push(time); },
    says: (track, time) => { if (time === 2) track.laps[3][0] = "8"; },
    takes: (track, time) => { if (time === 1) track.laps.pop(); },
    adds: (track, time) => { if (time === 1) track.laps.push(Float32Array.of(1.5, 2)); },
    gets: (track, time) => { if (time === 2) Object.defineProperty(track.laps[1], 2, { get() { track.seen++; return 3; } }); },
    lays: (track, time) => { if (time === 2) track.laps = track.laps.map(row => Array.from(row, value => value * 2)); },
};
for (const [name, make] of Object.entries(tracks)) {
    for (const [what, change] of Object.entries(between)) {
        const track = new Track(make());
        console.log(name, what, said(() => track.paces(5, change)), said(() => track.nearest(make()[2])), said(() => track.crossings(1)), said(() => track.crossings(3)), track.seen > 0);
    }
}
