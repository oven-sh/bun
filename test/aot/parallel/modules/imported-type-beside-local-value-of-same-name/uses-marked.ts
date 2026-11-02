import type { Sack } from "./marked";
import { type Pouch } from "./marked";
const Sack = { kilos: 1 };
const Pouch = { grams: 2 };
const typed: [Sack, Pouch] = [Sack, Pouch];
export const answer = typed;
