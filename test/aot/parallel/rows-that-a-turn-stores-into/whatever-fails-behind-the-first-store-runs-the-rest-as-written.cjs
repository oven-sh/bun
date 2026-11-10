// The rows are made by pushing: a row written as a literal is shared until it is first written, and the arm in kind would not take it.
// Every test of the typed arm is made to fail, in front of the first store and behind it, on rows of every kind; what was stored stays stored once, and nothing is stored twice.
// STATISTIC: RowStoreRegionsGuarded >= 1
"use strict";
function turned(count, grid, sine, cosine, from, to) { let held; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { held = grid[k][i + 1]; grid[k][i + 1] = sine * grid[k][i] + cosine * held; grid[k][i] = cosine * grid[k][i] - sine * held; } } }
function reached(count, grid, from, to) { for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { grid[k][i] = grid[k][i] * 2 + 1; grid[k][i + 3] = grid[k][i] + 0.5; } } }
function scaled(count, grid, sine, cosine, from, to) { for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) grid[k][i] = cosine * grid[k][i] - sine; } }
function shown(value) { return typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : typeof value === "object" && value ? "[" + listed(value) + "]" : String(value); }
function listed(row) { let text = ""; for (let i = 0; i < row.length; i++) text += (i in row ? shown(row[i]) : "hole") + ","; return text + "#" + row.length; }
function pushed(...values) { const row = []; for (const value of values) row.push(value); return row; }
function plainRows() { return pushed(pushed(0.5, 1.5, 2.5, 3.5), pushed(4.5, 5.5, 6.5, 7.5), pushed(8.5, 9.5, 10.5, 11.5)); }
function spoiledFromFirstRow(grid, spoil) { const kept = grid[0].slice(); let done = false; for (let j = 0; j < 4; j++) Object.defineProperty(grid[0], j, { get() { return kept[j]; }, set(value) { kept[j] = value; if (!done) { done = true; spoil(); } }, enumerable: true, configurable: true }); return grid; }
const kinds = {
    firstTurnMakesElementOfHolderHandOutOtherRows: grid => { let turn = 0; const spare = pushed(pushed(30.5, 31.5, 32.5, 33.5), pushed(40.5, 41.5, 42.5, 43.5)); grid.spare = spare; return spoiledFromFirstRow(grid, () => Object.defineProperty(grid, 1, { get() { return spare[turn++ & 1]; }, enumerable: true, configurable: true })); },
    firstTurnMakesElementOfHolderCountItsReads: grid => { const log = []; const row = grid[1]; grid.log = log; return spoiledFromFirstRow(grid, () => Object.defineProperty(grid, 1, { get() { log.push("r"); return row; }, enumerable: true, configurable: true })); },
    firstTurnMakesHolderSparse: grid => spoiledFromFirstRow(grid, () => { grid[5000] = [1.5]; }),
    firstTurnShortensHolder: grid => spoiledFromFirstRow(grid, () => { grid.length = 1; }),
    firstTurnEmptiesPlaceOfHolder: grid => { const spare = pushed(50.5, 51.5, 52.5, 53.5); grid.spare = [spare]; return spoiledFromFirstRow(grid, () => { delete grid[1]; Object.setPrototypeOf(grid, { __proto__: Array.prototype, 1: spare }); }); },
    firstTurnFillsHolderWithNumbers: grid => spoiledFromFirstRow(grid, () => { grid[1] = 1.5; grid[2] = 2.5; }),
    firstTurnFreezesNextRow: grid => spoiledFromFirstRow(grid, () => { Object.freeze(grid[1]); }),
    firstTurnShortensNextRow: grid => spoiledFromFirstRow(grid, () => { grid[1].length = 1; }),
    firstTurnPutsTextIntoNextRow: grid => spoiledFromFirstRow(grid, () => { grid[1][3] = "text"; }),
    asMade: grid => grid,
    secondValueIsNaN: grid => { grid[1][1] = Infinity; grid[1][2] = Infinity; return grid; },
    firstValueIsNaN: grid => { grid[1][1] = -Infinity; grid[1][2] = Infinity; return grid; },
    holeAtFirst: grid => { delete grid[1][2]; return grid; },
    holeAtSecond: grid => { delete grid[1][1]; return grid; },
    shortRow: grid => { grid[1].length = 2; return grid; },
    shorterRow: grid => { grid[1].length = 1; return grid; },
    emptyRow: grid => { grid[1].length = 0; return grid; },
    wholeNumbers: grid => { grid[1] = [1, 2, 3, 4]; return grid; },
    texts: grid => { grid[1] = ["a", "b", "c", "d"]; return grid; },
    mixed: grid => { grid[1] = [0.5, "b", 2.5, {}]; return grid; },
    frozen: grid => { Object.freeze(grid[1]); return grid; },
    sealed: grid => { Object.seal(grid[1]); return grid; },
    view: grid => { grid[1] = new Float64Array([4.5, 5.5, 6.5, 7.5]); return grid; },
    wholeView: grid => { grid[1] = new Int8Array([4, 5, 6, 7]); return grid; },
    sameRowTwice: grid => { grid[2] = grid[0]; return grid; },
    sameRowThrice: grid => { grid[1] = grid[0]; grid[2] = grid[0]; return grid; },
    namedProperty: grid => { grid[1].extra = 1; return grid; },
    ownPrototype: grid => { Object.setPrototypeOf(grid[1], { __proto__: Array.prototype }); return grid; },
    object: grid => { grid[1] = { 0: 4.5, 1: 5.5, 2: 6.5, 3: 7.5, length: 4 }; return grid; },
    setterAtFirst: grid => { let kept = 6.5; const log = []; Object.defineProperty(grid[1], 2, { get() { log.push("get"); return kept; }, set(value) { log.push("set"); kept = value; }, enumerable: true, configurable: true }); grid.log = log; return grid; },
    setterAtSecond: grid => { let kept = 5.5; const log = []; Object.defineProperty(grid[1], 1, { get() { log.push("get"); return kept; }, set(value) { log.push("set"); kept = value; }, enumerable: true, configurable: true }); grid.log = log; return grid; },
    setterSwapsRows: grid => { let kept = 6.5; const other = pushed(20.5, 21.5, 22.5, 23.5); Object.defineProperty(grid[1], 2, { get() { return kept; }, set(value) { kept = value; grid[1] = other; grid[2] = other; }, enumerable: true, configurable: true }); return grid; },
    holderHasHole: grid => { delete grid[1]; return grid; },
    holderHoldsNumber: grid => { grid[1] = 7; return grid; },
    holderHoldsNull: grid => { grid[1] = null; return grid; },
    holderIsObject: grid => ({ 0: grid[0], 1: grid[1], 2: grid[2], length: 3 }),
    holderFetchCounts: grid => { const log = []; const rows = [grid[0], grid[1], grid[2]]; const holder = new Proxy(rows, { get(target, key) { if (typeof key === "string" && key !== "length") log.push(key); return target[key]; } }); holder.log = log; return holder; },
    elementOfHolderHandsOutOtherRows: grid => { let turn = 0; const spare = pushed(pushed(30.5, 31.5, 32.5, 33.5), pushed(40.5, 41.5, 42.5, 43.5)); Object.defineProperty(grid, 1, { get() { return spare[turn++ & 1]; }, enumerable: true, configurable: true }); grid.spare = spare; return grid; },
    elementOfHolderCountsItsReads: grid => { const log = []; const row = grid[1]; Object.defineProperty(grid, 1, { get() { log.push("r"); return row; }, enumerable: true, configurable: true }); grid.log = log; return grid; },
    holderIsSparse: grid => { grid[5000] = [1.5]; return grid; },
    holderHasOwnPrototype: grid => { const spare = pushed(50.5, 51.5, 52.5, 53.5); delete grid[1]; Object.setPrototypeOf(grid, { __proto__: Array.prototype, 1: spare }); grid.spare = [spare]; return grid; },
    holderHandsOutOtherRows: grid => { let turn = 0; const spare = pushed(pushed(30.5, 31.5, 32.5, 33.5), pushed(40.5, 41.5, 42.5, 43.5)); return new Proxy(grid, { get(target, key) { return key === "1" ? spare[turn++ & 1] : target[key]; } }); },
};
const lines = [];
for (let round = 0; round < 60; round++) {
    for (const name of Object.keys(kinds)) {
        for (const i of [1, 0, 2]) {
          for (const way of [0, 1, 2, 3]) {
            const grid = round % 5 === 4 || round > 40 ? kinds[name](plainRows()) : plainRows();
            let ended = "";
            try { if (way === 3) scaled(3, grid, 0.6, 0.8, i + 1, i); else if (way === 2) reached(3, grid, i + 1, i); else turned(3, grid, 0.6, way ? -0.8 : 0.8, i + 1, i); } catch (error) { ended = error.constructor.name; }
            if (round === 59) { let text = name + " " + i + " " + way + ": "; for (let k = 0; k < 3; k++) { let row; try { row = grid[k]; } catch (error) { row = "threw"; } text += shown(row) + " "; } lines.push(text + ended + (grid.log ? " log " + grid.log.join("") : "") + (grid.spare ? " spare " + grid.spare.map(shown).join(" ") : "")); }
          }
        }
    }
}
console.log(lines.join("\n"));
