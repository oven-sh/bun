// Programs of ../destructuring-evaluation-order.ts, one per seed. That file describes them.
import { generate, specified } from "../destructuring-evaluation-order";
import { Random } from "../random";
import { endless } from "../family";

export default endless("destructuring evaluation order", index => {
  // Every tenth program ends with cases where plain Bun deviates from the specification; their expected output is
  // Node.js's.
  const hasSpecifiedLines = index % 10 === 9;
  return {
    name: `seed ${index + 1}.`,
    specified: hasSpecifiedLines ? specified : undefined,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1), hasSpecifiedLines) }),
  };
});
