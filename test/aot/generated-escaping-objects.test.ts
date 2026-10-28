import { program, roads } from "./generated/escaping-objects";
import { generated } from "./generated/run-generated";

const alwaysRun = new Set([
  "JSON.parse",
  "a name without code",
  "JSON.parse in a function of the program",
  "a message's data, read of the event",
  "a row of sqlite, straight",
]);

// By these roads the object is checked where it is held to the type. `r.a++` on one that lacks `a` throws in the executable, and under
// `bun run --aot` it yields NaN as in plain Bun.
// prettier-ignore
const modeDeparts = new Set(["a function of the program that yields any", "a literal under any", "a Map's value", "a message", "a message's data, read of the event", "JSON.parse in a callback of map", "JSON.parse in a function of the program", "JSON.parse in a generic function", "JSON.parse, then kept in a field", "JSON.parse, then through Promise.resolve", "JSON.parse.call", "Object.create with descriptors", "parse taken out of JSON by a pattern", "sqlite", "with a getter"]);

generated(
  "objects handed out",
  roads.flatMap(([road, expression]) => [
    { name: `${road}: what fits`, isAlwaysRun: alwaysRun.has(road), make: () => program(road, expression, "fits") },
    {
      name: `${road}: what does not fit`,
      isAlwaysRun: alwaysRun.has(road),
      modeFailsToday: modeDeparts.has(road) ? "r.a++ where a is missing" : undefined,
      make: () => program(road, expression, "does not fit"),
    },
  ]),
);
