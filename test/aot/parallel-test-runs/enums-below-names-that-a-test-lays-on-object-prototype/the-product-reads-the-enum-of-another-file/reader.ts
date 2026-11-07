import { State } from "./states.ts";
export function read() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return State.Ready === 3 ? "three" : String(State.Ready); }
