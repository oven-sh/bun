// STATISTIC: GuessesAtListsWhoseFailingSideAsksForViews = 0
"use strict";
function turned(V, j) { j = j | 0; let h = 0; for (let k = 0; k < V.length; k++) { h = V[k][j + 1]; V[k][j + 1] = 0.6 * V[k][j] + 0.8 * h; V[k][j] = 0.8 * V[k][j] - 0.6 * h; } return h; }
const go = { turned }[JSON.parse('"turned"')];
const V = []; for (let i = 0; i < 6; i++) { const row = []; for (let j = 0; j < 4; j++) row.push(i + j / 2); V.push(row); }
const said = [go(V, JSON.parse("1")), go(V, JSON.parse("2")), go(V, JSON.parse("3")), V[5].join()];
console.log(said.join(" | "));
