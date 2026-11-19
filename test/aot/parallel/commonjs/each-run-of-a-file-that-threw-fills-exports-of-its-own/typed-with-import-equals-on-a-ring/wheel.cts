const counter = globalThis as unknown as { turns?: number };
const turn: number = (counter.turns = (counter.turns ?? 0) + 1);
exports.turn = turn;
require("./spoke.cts");
if (turn === 1) throw new Error("boom");
