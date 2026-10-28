// @ts-nocheck
// Each of the first three names is imported twice as a value, so it is declared twice in one scope. One import of the last pair is gone when the program runs.
import { first as named } from "./other";
import { second as named } from "./other";
import byDefault from "./other";
import { first as byDefault } from "./other";
import * as star from "./other";
import { second as star } from "./other";
import type { OnlyAType as once } from "./other";
import { first as once } from "./other";
console.log(named, byDefault, star, once);
