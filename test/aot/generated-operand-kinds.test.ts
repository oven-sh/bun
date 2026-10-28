import { operations, program, sources } from "./generated/operands";
import { operationsOnAnyValue, sourcesOfEveryKind } from "./generated/operands-every-kind";
import { generated } from "./generated/run-generated";

const alwaysRun = new Set([
  '"" written',
  'a parameter: "5" or left out',
  "one of -0 and undefined",
  "[5] under number[] | null",
]);
// An optional chain can be neither a template's tag nor stored to.
const isOptionalChain = (source: (typeof sources)[number]) =>
  "expression" in source && source.expression.includes("?.");

generated("operands of every kind", [
  ...sourcesOfEveryKind.map(source => ({
    name: source.name,
    isAlwaysRun: alwaysRun.has(source.name),
    make: () => program(source, [...operations, ...operationsOnAnyValue]),
  })),
  ...sources
    .filter(source => !source.loose && !isOptionalChain(source))
    .map(source => ({
      name: `${source.name}: what is done with any value`,
      isAlwaysRun: source.name === "undefined written" || source.name === "a parameter: a double or left out",
      make: () => program(source, operationsOnAnyValue),
    })),
]);
