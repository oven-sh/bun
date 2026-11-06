import { program, sources } from "../generators/operands";
import { family } from "../family";

export default family(
  "operands",
  sources.map(source => ({ name: source.name, make: () => program(source) })),
);
