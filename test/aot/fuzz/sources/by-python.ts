// The generators under ../generators/python write random programs: `python3 <generator>.py <seed>` prints one, and the same seed always prints the same program. The top of each
// generator says what its programs are about. Seed n draws from generator n modulo their number, with a seed of that generator that grows with n, or
// with one of the numbers that its line in the list names. Without python3 nothing is drawn.
import { generators, headingOf, program, python } from "../generators/python-generators";
import { asProgram, type Drawn } from "../family";

const drawn: Drawn = (seed, bed) => {
  if (!python || bed.name !== "product") return;
  const [name, extension, options = {}] = generators[seed % generators.length];
  const turn = Math.floor(seed / generators.length);
  // The number that some generators take is no seed but a size or a row of a table: those get the numbers that their line names, in turns.
  const its = options.seeds ? options.seeds[turn % options.seeds.length] : turn + 1;
  if (options.leftOut?.includes(its) || typeof options.failsToday === "string" || options.failsToday?.[its]) return;
  const made = asProgram(program(name, extension, options, its), [], options.plainEnv);
  return made && { seed, ...made, notes: `${headingOf(name, extension)} ${its}`, group: name, standsAlone: true };
};
export default drawn;
