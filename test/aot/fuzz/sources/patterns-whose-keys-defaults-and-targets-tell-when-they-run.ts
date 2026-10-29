// fuzz/patterns-whose-keys-defaults-and-targets-tell-when-they-run.ts: patterns in declarations, assignments, parameters, `catch` and the heads of loops, over lists, iterators,
// getters and proxies that tell of everything done to them. They print the order of everything, what each name holds, what is thrown and what had been assigned by then.
import { generate, written } from "../patterns-whose-keys-defaults-and-targets-tell-when-they-run";
import { Random } from "../random";
import { endless } from "../family";

export default endless("patterns whose keys, defaults and targets tell when they run", index => {
  // Every tenth program ends with what plain Bun answers otherwise than the language says: there the answers of Node.js are written down.
  const hasWhatIsWritten = index % 10 === 9;
  return {
    name: `seed ${index + 1}.`,
    written: hasWhatIsWritten ? written : undefined,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1), hasWhatIsWritten) }),
  };
});
