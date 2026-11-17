import { weights, move } from "./weights.mjs";
export function weigh(xs, at) { let s = 0; for (let i = 0; i < xs.length; i++) { s += weights[0] * xs[i]; if (i === at) move(7.5); } return s; }
