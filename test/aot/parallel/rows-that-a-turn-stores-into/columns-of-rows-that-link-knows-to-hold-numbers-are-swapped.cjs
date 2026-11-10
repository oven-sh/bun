// Nothing is computed with what a swap moves, so nothing written says that the rows hold numbers; Link has seen what is pushed into them. The row is asked once all the same, and whatever it is at the run the swap moves what plain moves.
// STATISTIC: RowsAskedOnceWhereStretchesStoreIntoThem >= 1
"use strict";
function made(count, width, start) { const grid = []; for (let k = 0; k < count; k++) { const row = []; for (let i = 0; i < width; i++) row.push(k * 0.5 + i * 0.25 + start); grid.push(row); } return grid; }
function swapped(grid, a, b) { for (let j = 0; j < grid.length; j++) { const held = grid[j][a]; grid[j][a] = grid[j][b]; grid[j][b] = held; } }
function shown(value) { return typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : String(value); }
function listed(row) { let text = ""; for (let i = 0; i < row.length; i++) text += (i in row ? shown(row[i]) : "hole") + ","; return text + "#" + row.length; }
const kinds = {
    asMade: grid => grid,
    wholeNumbers: grid => { for (let i = 0; i < 5; i++) grid[1][i] = i * 3; return grid; },
    oneWholeNumber: grid => { grid[1][1] = 7; return grid; },
    minusZero: grid => { grid[1][1] = -0; grid[1][3] = 0; return grid; },
    notANumber: grid => { grid[1][1] = NaN; return grid; },
    infinities: grid => { grid[1][1] = Infinity; grid[1][3] = -Infinity; return grid; },
    holeAtFirst: grid => { delete grid[1][1]; return grid; },
    holeAtSecond: grid => { delete grid[1][3]; return grid; },
    holesAtBoth: grid => { delete grid[1][1]; delete grid[1][3]; return grid; },
    shortRow: grid => { grid[1].length = 2; return grid; },
    emptyRow: grid => { grid[1].length = 0; return grid; },
    longRow: grid => { grid[1].push(9.5, 10.5, 11.5); return grid; },
    frozen: grid => { Object.freeze(grid[1]); return grid; },
    sealed: grid => { Object.seal(grid[1]); return grid; },
    notExtensible: grid => { Object.preventExtensions(grid[1]); return grid; },
    sameRowTwice: grid => { grid[2] = grid[0]; return grid; },
    sameRowThrice: grid => { grid[1] = grid[0]; grid[2] = grid[0]; return grid; },
    named: grid => { grid[1].extra = 1.5; return grid; },
    holderHasHole: grid => { delete grid[1]; return grid; },
    holderIsShort: grid => { grid.length = 1; return grid; },
};
const lines = [];
for (let round = 0; round < 60; round++) {
    const odd = round % 5 === 4 || round > 40;
    for (const name of Object.keys(kinds)) {
        for (const [a, b] of [[1, 3], [3, 1], [0, 4], [2, 2], [1, 5], [5, 1], [4, 9], [0, 1]]) {
            const grid = odd ? kinds[name](made(3, 5, 0.125)) : made(3, 5, 0.125);
            let ended = "";
            try { swapped(grid, odd ? a : a & 3, odd ? b : b & 3); } catch (error) { ended = error.constructor.name; }
            if (round === 59) { let text = name + " " + a + " " + b + ": "; for (let k = 0; k < 3; k++) text += (grid[k] ? listed(grid[k]) : String(grid[k])) + " "; lines.push(text + ended); }
        }
    }
}
console.log(lines.join("\n"));
