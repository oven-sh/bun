// Variables are carried round the loop and read behind it; work is done behind the stores in the same turn; the turn goes on or ends there. Whichever arm a turn takes, and wherever the next turn runs, what comes round is what plain brings round.
// STATISTIC: RowsAskedOnceWhereStretchesStoreIntoThem >= 4
// STATISTIC: RestsOfStretchesThatMayRunAsWritten >= 3
"use strict";
function pushed(...values) { const row = []; for (const value of values) row.push(value); return row; }
function rows() { return pushed(pushed(0.5, 1.5, 2.5, 3.5), pushed(4.5, 5.5, 6.5, 7.5), pushed(8.5, 9.5, 10.5, 11.5), pushed(12.5, 13.5, 14.5, 15.5)); }
function carried(count, grid, sine, cosine, from, to) { let held = -1, sum = 0, seen = 0; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { held = grid[k][i + 1]; grid[k][i + 1] = sine * grid[k][i] + cosine * held; grid[k][i] = cosine * grid[k][i] - sine * held; sum += grid[k][i] + k; seen++; } } return held + ":" + sum + ":" + seen; }
function goesOn(count, grid, sine, cosine, from, to) { let held = -1, sum = 0, seen = 0; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { held = grid[k][i + 1]; grid[k][i + 1] = sine * grid[k][i] + cosine * held; grid[k][i] = cosine * grid[k][i] - sine * held; if (held > 6) continue; sum += held; seen++; } } return held + ":" + sum + ":" + seen; }
function ends(count, grid, sine, cosine, from, to) { let held = -1, sum = 0, last = -1; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { held = grid[k][i + 1]; grid[k][i + 1] = sine * grid[k][i] + cosine * held; grid[k][i] = cosine * grid[k][i] - sine * held; last = k; if (!(held < 10)) break; sum += held; } } return held + ":" + sum + ":" + last; }
function caught(count, grid, sine, cosine, from, to) { let held = -1, sum = 0, said = ""; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { try { held = grid[k][i + 1]; grid[k][i + 1] = sine * grid[k][i] + cosine * held; grid[k][i] = cosine * grid[k][i] - sine * held; sum += held; } catch (error) { said += error.constructor.name + k + ":" + held + ";"; } } } return held + ":" + sum + ":" + said; }
function shown(value) { return typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : typeof value === "object" && value ? "[" + listed(value) + "]" : String(value); }
function listed(row) { let text = ""; for (let i = 0; i < row.length; i++) { let value; try { value = i in row ? shown(row[i]) : "hole"; } catch (error) { value = "threw"; } text += value + ","; } return text + "#" + row.length; }
function withSetters(grid, which, behind) { const row = grid[which], kept = row.slice(); let done = false; for (let j = 0; j < 4; j++) Object.defineProperty(row, j, { get() { return kept[j]; }, set(value) { kept[j] = value; if (!done) { done = true; behind(); } }, enumerable: true, configurable: true }); return grid; }
const kinds = {
    asMade: grid => grid,
    secondValueIsNaNInSecondRow: grid => { grid[1][1] = Infinity; grid[1][2] = -Infinity; return grid; },
    secondValueIsNaNInLastRow: grid => { grid[3][1] = Infinity; grid[3][2] = -Infinity; return grid; },
    secondValueIsNaNInEveryRow: grid => { for (const row of grid) { row[1] = Infinity; row[2] = -Infinity; } return grid; },
    holeInSecondRow: grid => { delete grid[1][1]; return grid; },
    shortSecondRow: grid => { grid[1].length = 2; return grid; },
    wholeNumbersInThirdRow: grid => { grid[2] = pushed(1, 2, 3, 4); return grid; },
    textInThirdRow: grid => { grid[2][3] = "t"; return grid; },
    frozenThirdRow: grid => { Object.freeze(grid[2]); return grid; },
    viewAsSecondRow: grid => { grid[1] = new Float64Array([4.5, 5.5, 6.5, 7.5]); return grid; },
    missingThirdRow: grid => { grid[2] = undefined; return grid; },
    settersInFirstRow: grid => withSetters(grid, 0, () => {}),
    settersInSecondRowSwapTheRest: grid => withSetters(grid, 1, () => { const row = grid[2]; grid[2] = grid[3]; grid[3] = row; }),
    settersInSecondRowShortenTheHolder: grid => withSetters(grid, 1, () => { grid.length = 3; }),
    settersInSecondRowLengthenTheHolder: grid => withSetters(grid, 1, () => { grid.push(pushed(20.5, 21.5, 22.5, 23.5)); }),
    settersInSecondRowMakeTheNextAGetter: grid => { let turn = 0; const spare = pushed(pushed(30.5, 31.5, 32.5, 33.5), pushed(40.5, 41.5, 42.5, 43.5)); grid.spare = spare; return withSetters(grid, 1, () => Object.defineProperty(grid, 2, { get() { return spare[turn++ & 1]; }, enumerable: true, configurable: true })); },
    settersInSecondRowFreezeTheNext: grid => withSetters(grid, 1, () => { Object.freeze(grid[2]); }),
    settersInSecondRowThrow: grid => withSetters(grid, 1, () => { throw new RangeError("from a setter"); }),
};
const lines = [];
for (let round = 0; round < 60; round++) {
    const odd = round % 5 === 4 || round > 40;
    for (const name of Object.keys(kinds)) {
        for (const way of [carried, goesOn, ends, caught]) {
            for (const cosine of [0.8, -0.8]) {
                for (const [from, to] of [[2, 1], [3, 0], [1, 0]]) {
                    const grid = odd ? kinds[name](rows()) : rows();
                    let answer;
                    try { answer = way(grid.length, grid, 0.6, cosine, from, to); } catch (error) { answer = "out:" + error.constructor.name; }
                    if (round === 59) lines.push(name + " " + way.name + " " + cosine + " " + from + to + ": " + answer + " | " + Array.from({ length: grid.length }, (_, k) => { try { return shown(grid[k]); } catch (error) { return "threw"; } }).join(" ") + (grid.spare ? " spare " + grid.spare.map(shown).join(" ") : ""));
                }
            }
        }
    }
}
console.log(lines.join("\n"));
