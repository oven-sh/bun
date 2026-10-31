// Random programs from the scripts in ../generators/python: `python3 <generator>.py <seed>` prints one program, and the
// same seed always prints the same program. The top of each script says what its programs test. Seed n uses generator n
// modulo their number. Generates nothing without python3.
import { generators, headingOf, program, python } from "../generators/python-generators";
import { asProgram, type Drawn } from "../family";

const drawn: Drawn = (seed, runner) => {
  if (!python || runner.name !== "product") return;
  const [name, extension, options = {}] = generators[seed % generators.length];
  const turn = Math.floor(seed / generators.length);
  // For some generators the number is not a seed but a size or a table row: those get the numbers listed in their
  // entry, in rotation.
  const its = options.seeds ? options.seeds[turn % options.seeds.length] : turn + 1;
  const made = asProgram(program(name, extension, options, its), [], options.plainEnv);
  return made && { seed, ...made, notes: `${headingOf(name, extension)} ${its}`, group: name, needsOwnBuild: true };
};
export default drawn;
