// A handler stands round the turn, round the loops, or behind them as a cleanup, and reads what the turn held; a text grows between the two stores. Whatever arm the turn takes, the handler sees what was written and the text grows once.
// STATISTIC: RowStoreRegionsGuarded >= 1
// STATISTIC: RowStoreRegionsGuarded >= 1
"use strict";
function pushed(...values) { const row = []; for (const value of values) row.push(value); return row; }
function rows() { return pushed(pushed(0.5, 1.5, 2.5, 3.5), pushed(4.5, 5.5, 6.5, 7.5), pushed(8.5, 9.5, 10.5, 11.5)); }
function caughtInTurn(count, grid, first, second, from, to) { let held = -1, seen = ""; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { try { held = grid[k][i + 1]; grid[k][i + 1] = first * grid[k][i] + 0.8 * held; grid[k][i] = second * grid[k][i] - 0.6 * held; } catch (error) { seen += error.constructor.name + ":" + k + ":" + i + ":" + held + ";"; } } } return seen; }
function caughtRoundLoops(count, grid, first, second, from, to) { let held = -1, k = -1, i = -1; try { for (i = from - 1; i >= to; i--) { for (k = 0; k < count; k++) { held = grid[k][i + 1]; grid[k][i + 1] = first * grid[k][i] + 0.8 * held; grid[k][i] = second * grid[k][i] - 0.6 * held; } } } catch (error) { return error.constructor.name + ":" + k + ":" + i + ":" + held; } return "ended:" + held; }
function cleanedInTurn(count, grid, first, second, from, to) { let held = -1, seen = ""; try { for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { try { held = grid[k][i + 1]; grid[k][i + 1] = first * grid[k][i] + 0.8 * held; grid[k][i] = second * grid[k][i] - 0.6 * held; } finally { seen += k + ":" + held + ";"; } } } } catch (error) { seen += error.constructor.name; } return seen; }
function textBetween(count, grid, first, second, from, to) { let held = -1, text = ""; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { held = grid[k][i + 1]; text += "a" + k; grid[k][i + 1] = first * grid[k][i] + 0.8 * held; text += "b" + i; grid[k][i] = second * grid[k][i] - 0.6 * held; text += "c"; } } return text; }
function textAndReach(count, grid, first, second, from, to) { let text = ""; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { grid[k][i] = grid[k][i] * first + 1; text += "<" + k; grid[k][i + 3] = grid[k][i] + second; text += ">"; } } return text; }
function shown(value) { return typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : typeof value === "object" && value ? "[" + listed(value) + "]" : String(value); }
function listed(row) { let text = ""; for (let i = 0; i < row.length; i++) { let value; try { value = i in row ? shown(row[i]) : "hole"; } catch (error) { value = "threw"; } text += value + ","; } return text + "#" + row.length; }
const kinds = {
    asMade: grid => grid,
    secondIsNaN: grid => { grid[1][1] = Infinity; grid[1][2] = -Infinity; return grid; },
    hole: grid => { delete grid[1][1]; return grid; },
    shortRow: grid => { grid[1].length = 2; return grid; },
    frozen: grid => { Object.freeze(grid[1]); return grid; },
    notExtensible: grid => { Object.preventExtensions(grid[1]); return grid; },
    lengthHeld: grid => { Object.defineProperty(grid[1], "length", { writable: false }); return grid; },
    missingRow: grid => { grid[1] = undefined; return grid; },
    nullRow: grid => { grid[1] = null; return grid; },
    setterThrowsAtFirst: grid => { Object.defineProperty(grid[1], 2, { get() { return 6.5; }, set() { throw new EvalError("first"); }, enumerable: true, configurable: true }); return grid; },
    setterThrowsAtSecond: grid => { Object.defineProperty(grid[1], 1, { get() { return 5.5; }, set() { throw new EvalError("second"); }, enumerable: true, configurable: true }); return grid; },
    getterThrows: grid => { Object.defineProperty(grid[1], 1, { get() { throw new URIError("read"); }, enumerable: true, configurable: true }); return grid; },
    view: grid => { grid[1] = new Float64Array([4.5, 5.5, 6.5, 7.5]); return grid; },
};
const factors = [[0.6, 0.8], [0.6, -0.8], [-0.6, 0.8], [0, 0.8], [0.6, 0], [NaN, 0.8], [0.6, NaN], [Infinity, 0.8], [0.6, -Infinity]];
const ways = [caughtInTurn, caughtRoundLoops, cleanedInTurn, textBetween, textAndReach];
const lines = [];
for (let round = 0; round < 50; round++) {
    for (const name of Object.keys(kinds)) {
        for (const way of ways) {
            for (let f = 0; f < factors.length; f++) {
                const odd = round % 5 === 4 || round > 35;
                const grid = odd ? kinds[name](rows()) : rows();
                const [first, second] = odd ? factors[f] : factors[f & 1];
                let answer;
                try { answer = way(3, grid, first, second, 2, 1); } catch (error) { answer = "out:" + error.constructor.name; }
                if (round === 49) lines.push(name + " " + way.name + " " + f + ": " + answer + " | " + [0, 1, 2].map(k => shown(grid[k])).join(" "));
            }
        }
    }
}
console.log(lines.join("\n"));
