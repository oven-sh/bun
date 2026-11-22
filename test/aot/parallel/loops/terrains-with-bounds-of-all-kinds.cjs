"use strict";
// Bounds of inner loops over readers: numbers of both kinds, texts, fields that other code lays, rows of several kinds.
class Terrain {
    constructor(deep, wide, height) {
        this.deep = deep;
        this.wide = wide;
        this.ridges = [];
        for (let south = 0; south < deep; south++) {
            const ridge = [];
            for (let east = 0; east < wide; east++)
                ridge.push(height(south, east));
            this.ridges.push(ridge);
        }
    }

    height(south, east) {
        return this.ridges[south][east];
    }

    steepest() {
        let most = -Infinity;
        let where = -1;
        for (let south = 0; south < this.deep; south++) {
            for (let east = 1; east < this.wide; east++) {
                const climb = this.height(south, east) - this.height(south, east - 1);
                if (climb > most) {
                    most = climb;
                    where = south * 1000 + east;
                }
            }
        }
        return most.toFixed(3) + " at " + where;
    }

    flooded(level, shores) {
        let wet = 0;
        for (let south = 0; south < this.deep; south++) {
            for (let east = 0; east < shores; east++)
                wet += this.height(south, east) < level ? 1 : 0;
        }
        return wet;
    }

    slopes() {
        const deep = this.deep;
        const wide = this.wide | 0;
        let sum = 0;
        for (let south = 1; south < deep; south++) {
            for (let east = 0; east < wide; east++)
                sum += Math.abs(this.height(south, east) - this.height(south - 1, east));
        }
        return sum.toFixed(4);
    }

    raise(by) {
        for (let south = 0; south < this.deep; south++) {
            const ridge = this.ridges[south];
            for (let east = 0; east < this.wide; east++)
                ridge[east] = ridge[east] * by + this.height(south, 0);
        }
        return this;
    }
}

class Coast {
    constructor(cliffs) {
        this.cliffs = cliffs;
    }

    cliff(south, east) {
        return this.cliffs[south][east];
    }

    total(deep, wide) {
        let total = 0;
        for (let south = 0; south < deep; south++) {
            for (let east = 0; east < wide; east++)
                total += this.cliff(south, east);
        }
        return total;
    }
}
const coast = new Coast(Array.from({ length: 20 }, (_, south) => Array.from({ length: 24 }, (__, east) => Math.sin(south * east + 1))));
const reaches = JSON.parse('[[20, 24], [10.0, 5], [3, 7.5], [4, "6"], [2, null], [0, 3], [5, -1], ["3", 4], [6, 24]]');
for (let round = 0; round < 4; round++)
    console.log(reaches.map(([deep, wide]) => coast.total(deep, wide).toFixed(6)).join());

const show = (name, ask) => {
    let line;
    try {
        line = String(ask());
    } catch (error) {
        line = error.constructor.name;
    }
    console.log(name, line);
};
const visit = (name, land) => {
    for (let round = 0; round < 3; round++) {
        show(name + " steepest", () => land.steepest());
        show(name + " flooded", () => [land.flooded(2, land.wide), land.flooded(0.5, 3), land.flooded(9, "4"), land.flooded(1, 2.5), land.flooded(1, NaN), land.flooded(1, -3), land.flooded(3, undefined)].join());
        show(name + " slopes", () => land.slopes());
        show(name + " raise", () => land.raise(round ? 1.01 : 1).height(1, 2));
    }
};

visit("sines", new Terrain(9, 14, (south, east) => Math.sin(south * 1.3 + east) * 3));
visit("whole", new Terrain(8, 11, (south, east) => (south * 7 + east * 5) % 13));
visit("mixed", new Terrain(6, 9, (south, east) => (south & 1 ? east : east / 4)));
visit("wide as text", Object.assign(new Terrain(5, 6, (south, east) => south + east * 0.5), { wide: "6" }));
visit("wide of a fraction", Object.assign(new Terrain(5, 6, (south, east) => south * east), { wide: 4.5 }));
visit("wider than its ridges", Object.assign(new Terrain(4, 5, (south, east) => south - east), { wide: 7 }));
visit("views", Object.assign(new Terrain(4, 6, () => 0), { ridges: Array.from({ length: 4 }, (_, south) => Float32Array.from({ length: 6 }, (__, east) => south * 0.1 + east)) }));
visit("holes", Object.assign(new Terrain(3, 5, () => 0), { ridges: [[1, , 3, , 5], [, 2, 2.5, 4, 1], [0, 1, , 1, 0]] }));
visit("texts", Object.assign(new Terrain(3, 4, () => 0), { ridges: [["1", "2", 3, 4], [4, "3", 2, 1], [0, 0, "0", 5]] }));
let asked = 0;
const watched = new Terrain(4, 5, (south, east) => south * 2 - east);
Object.defineProperty(watched, "wide", { get() { return ++asked > 40 ? 3 : 5; }, configurable: true });
visit("a watched width", watched);
console.log(asked);
