import { describeOverload } from "./check-overloads.ts";
import type { Problems } from "./declarations.ts";
import { describeOperand } from "./dispatch.ts";
import type { ModelOverload, ModelParameter, ModelType, TableModel } from "./model.ts";

const operandsOf = ({ receiver, parameters }: ModelOverload): readonly ModelParameter[] =>
  receiver === null ? parameters : [receiver, ...parameters];

function namesPlainData(type: ModelType): boolean {
  if (type.hasPlainData) return true;
  return type.parts.some(part => part.part === "Instance" && part.contents.some(held => namesPlainData(held.type)));
}

// "New plain data" says what a call makes: new objects and arrays that hold each other and primitives.
export function checkOperandTypes({ overloads }: Pick<TableModel, "overloads">, problems: Problems): void {
  for (const overload of overloads) {
    for (const { operand, accepted, converted, refused } of operandsOf(overload)) {
      if (![accepted, converted, refused].some(namesPlainData)) continue;
      problems.add(
        overload.source,
        `${describeOverload(overload)}: b.plainData describes a result, and ${describeOperand(operand)} is tested for it`,
      );
    }
  }
}
