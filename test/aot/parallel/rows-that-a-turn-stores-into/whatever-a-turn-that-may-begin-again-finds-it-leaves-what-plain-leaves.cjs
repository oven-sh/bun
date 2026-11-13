// What is odd is handed over unseen: where views are SEEN to arrive at the rows, the copy for lists is not bought.
// Loops whose turns find a row and store into it once or twice, with values carried round and work behind the stores. A turn that finds an odd row begins again in the other copy of the loop; a store that was done in kind is put back first. Whatever is found, and whatever a setter does to what lies ahead, plain's answer comes out.
// STATISTIC: RowStoreRegionsRestartingIterations >= 2
// STATISTIC: StoresUndoneAtIterationRestarts >= 1
"use strict";
const unseen = value => ({ value })[JSON.parse('"value"')];
function pushed(...values) { const row = []; for (const value of values) row.push(value); return row; }
function rows() { return pushed(pushed(0.5, 1.5, 2.5, 3.5), pushed(4.5, 5.5, 6.5, 7.5), pushed(8.5, 9.5, 10.5, 11.5), pushed(12.5, 13.5, 14.5, 15.5)); }
function damped(count, grid, loss, gain, from, to) { for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) grid[k][i] = gain * grid[k][i] - loss; } return grid.length; }
function dampedAndSummed(count, grid, loss, gain, from, to) { let sum = 0, seen = 0; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { grid[k][i] = gain * grid[k][i] - loss; sum += grid[k][i] + k; seen++; } } return sum + ":" + seen; }
function dampedBesideItsNeighbor(count, grid, loss, gain, from, to) { let last = -1; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { grid[k][i] = gain * grid[k][i] - loss; grid[k][i + 1] = gain * grid[k][i + 1] + loss * grid[k][i]; last = k; } } return last; }
function dampedUnderAHandler(count, grid, loss, gain, from, to) { let said = ""; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { try { grid[k][i] = gain * grid[k][i] - loss; } catch (error) { said += error.constructor.name + k + ";"; } } } return said; }
function turnedByName(count, grid, sine, cosine, from, to) { let held = -1; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { const row = grid[k]; held = row[i + 1]; row[i + 1] = sine * row[i] + cosine * held; row[i] = cosine * row[i] - sine * held; } } return held; }
function turnedByNameAndSummed(count, grid, sine, cosine, from, to) { let held = -1, sum = 0, seen = 0; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { const row = grid[k]; held = row[i + 1]; row[i + 1] = sine * row[i] + cosine * held; row[i] = cosine * row[i] - sine * held; sum += held; seen++; } } return held + ":" + sum + ":" + seen; }
function shown(value) { return typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : typeof value === "object" && value ? "[" + listed(value) + "]" : String(value); }
function listed(row) { let text = ""; for (let i = 0; i < row.length; i++) { let value; try { value = i in row ? shown(row[i]) : "hole"; } catch (error) { value = "threw"; } text += value + ","; } return text + "#" + row.length; }
function withSetters(grid, which, behind) { const row = grid[which], kept = row.slice(); let done = false; for (let j = 0; j < 4; j++) Object.defineProperty(row, j, { get() { return kept[j]; }, set(value) { kept[j] = value; if (!done) { done = true; behind(); } }, enumerable: true, configurable: true }); return grid; }
const kinds = {
    asMade: grid => grid,
    valueIsNaNInSecondRow: grid => { grid[1][1] = Infinity; grid[1][2] = Infinity; return grid; },
    secondValueIsNaNInSecondRow: grid => { grid[1][1] = Infinity; grid[1][2] = -Infinity; return grid; },
    secondValueIsNaNInFirstRow: grid => { grid[0][0] = Infinity; grid[0][1] = -Infinity; grid[0][2] = Infinity; return grid; },
    valueIsNaNInEveryRow: grid => { for (const row of grid) { row[1] = Infinity; row[2] = Infinity; } return grid; },
    minusZero: grid => { grid[1][1] = -0; grid[2][2] = -0; return grid; },
    holeInFirstRow: grid => { delete grid[0][1]; return grid; },
    holeInSecondRow: grid => { delete grid[1][2]; return grid; },
    holeInLastRow: grid => { delete grid[3][1]; return grid; },
    shortSecondRow: grid => { grid[1].length = 1; return grid; },
    emptyThirdRow: grid => { grid[2].length = 0; return grid; },
    wholeNumbersInThirdRow: grid => { grid[2] = pushed(1, 2, 3, 4); return grid; },
    literalAsThirdRow: grid => { grid[2] = [8.5, 9.5, 10.5, 11.5]; return grid; },
    textInThirdRow: grid => { grid[2][3] = "t"; return grid; },
    objectInSecondRow: grid => { grid[1][1] = { valueOf() { return 2.5; } }; return grid; },
    frozenThirdRow: grid => { Object.freeze(grid[2]); return grid; },
    notExtensibleShortRow: grid => { grid[1].length = 2; Object.preventExtensions(grid[1]); return grid; },
    viewAsSecondRow: grid => { grid[1] = unseen(new Float64Array([4.5, 5.5, 6.5, 7.5])); return grid; },
    wholeViewAsSecondRow: grid => { grid[1] = unseen(new Int32Array([4, 5, 6, 7])); return grid; },
    plainObjectAsSecondRow: grid => { grid[1] = unseen({ 0: 4.5, 1: 5.5, 2: 6.5, 3: 7.5, length: 4 }); return grid; },
    missingThirdRow: grid => { grid[2] = undefined; return grid; },
    sameRowTwice: grid => { grid[2] = grid[0]; return grid; },
    sameRowEverywhere: grid => { grid[1] = grid[0]; grid[2] = grid[0]; grid[3] = grid[0]; return grid; },
    holderHasHole: grid => { delete grid[2]; return grid; },
    settersInFirstRow: grid => withSetters(grid, 0, () => {}),
    settersInSecondRowSwapTheRest: grid => withSetters(grid, 1, () => { const row = grid[2]; grid[2] = grid[3]; grid[3] = row; }),
    settersInSecondRowShortenTheHolder: grid => withSetters(grid, 1, () => { grid.length = 3; }),
    settersInSecondRowMakeTheNextAGetter: grid => { let turn = 0; const spare = pushed(pushed(30.5, 31.5, 32.5, 33.5), pushed(40.5, 41.5, 42.5, 43.5)); grid.spare = spare; return withSetters(grid, 1, () => Object.defineProperty(grid, 2, { get() { return spare[turn++ & 1]; }, enumerable: true, configurable: true })); },
    settersInSecondRowFreezeTheNext: grid => withSetters(grid, 1, () => { Object.freeze(grid[2]); }),
    settersInSecondRowMakeTheNextWhole: grid => withSetters(grid, 1, () => { grid[2] = pushed(1, 2, 3, 4); }),
    settersInSecondRowThrow: grid => withSetters(grid, 1, () => { throw new RangeError("from a setter"); }),
};
const lines = [];
for (let round = 0; round < 60; round++) {
    const odd = round % 5 === 4 || round > 40;
    for (const name of Object.keys(kinds)) {
        for (let way = 0; way < 6; way++) {
            for (let step = 0; step < 3; step++) {
                const gain = 0.8 - step * 0.8;
                for (let range = 0; range < 3; range++) {
                    const from = range === 0 ? 2 : range === 1 ? 3 : 1, to = range === 0 ? 1 : 0;
                    const grid = odd ? kinds[name](rows()) : rows();
                    let answer;
                    try {
                        if (way === 0) answer = damped(4, grid, 0.6, gain, from, to);
                        else if (way === 1) answer = dampedAndSummed(4, grid, 0.6, gain, from, to);
                        else if (way === 2) answer = dampedBesideItsNeighbor(4, grid, 0.6, gain, from, to);
                        else if (way === 3) answer = dampedUnderAHandler(4, grid, 0.6, gain, from, to);
                        else if (way === 4) answer = turnedByName(4, grid, 0.6, gain, from, to);
                        else answer = turnedByNameAndSummed(4, grid, 0.6, gain, from, to);
                    } catch (error) { answer = "out:" + error.constructor.name; }
                    if (round === 59) lines.push(name + " " + way + " " + gain + " " + from + to + ": " + answer + " | " + Array.from({ length: grid.length }, (_, k) => { try { return shown(grid[k]); } catch (error) { return "threw"; } }).join(" ") + (grid.spare ? " spare " + grid.spare.map(shown).join(" ") : ""));
                }
            }
        }
    }
}
console.log(lines.join("\n"));
