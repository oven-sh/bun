// `Object.assign(Array.prototype, make())`: neither the name of the member nor its value stands in the statement that writes it. The same
// goes for a spread, for descriptors taken off another object, for a loop over the keys of a source, for a mixin.
// The scenes are those of ./two-roads: something with a name gets or loses a member that way, in half of the programs under
// its own name and else by a second road, and the member is read by name in a function.
import type { Random } from "./random";
import { generateWith } from "./two-roads";

export const generate = (random: Random, typed: boolean) => generateWith(random, typed, { copies: true });
