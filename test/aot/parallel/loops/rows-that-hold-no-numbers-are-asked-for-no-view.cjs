// STATISTIC: GuessesAtListsWhoseFailingSideAsksForViews = 0
"use strict";
function lit(grid) { let s = 0; for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) if (grid[r][c]) s++; return s; }
const go = { lit }[JSON.parse('"lit"')];
const grid = Array.from({ length: 9 }, (_, r) => Array.from({ length: 7 }, (_, c) => (r * 7 + c * 3) % 5 === 0));
const said = [go(grid)];
grid[2] = Float64Array.of(0, 1.5, NaN, -0, 2); said.push(go(grid)); grid[3] = "text"; said.push(go(grid)); grid[4] = [[], 0, "", null, {}]; said.push(go(grid));
console.log(said.join(" | "));
