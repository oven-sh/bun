// @ts-nocheck
// An enum that is only declared has no code: what reads the exported enum of its name needs the exported enum's.
import { M, N } from "./library";
import * as library from "./library";
console.log(M, M.S, library[JSON.parse('"M"')], N);
