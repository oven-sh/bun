import type { Problems } from "./declarations.ts";
import type { ModelBuiltin, ModelClass, TableModel } from "./model.ts";

const arrayBufferCellType = "ArrayBufferType";

function readsCellType({ instanceTest }: ModelClass): boolean {
  switch (instanceTest) {
    case "None":
    case "ClassInfoInherits":
      return false;
    case "JSTypeEquals":
    case "SharingModeEquals":
      return true;
  }
}

function extendsClass(builtinClass: ModelClass, ancestor: ModelClass): boolean {
  let current: ModelClass | null = builtinClass;
  while (current !== null && current !== ancestor) current = current.parent;
  return current !== null;
}

function haveDifferentSharingModes(first: ModelClass, second: ModelClass): boolean {
  return first.sharingMode !== null && second.sharingMode !== null && first.sharingMode !== second.sharingMode;
}

function checkSharingMode(builtinClass: ModelClass, problems: Problems): void {
  if (builtinClass.sharingMode === null) return;
  if (builtinClass.instanceTest === "SharingModeEquals" && builtinClass.jsType === arrayBufferCellType) return;
  problems.add(
    null,
    `the class ${builtinClass.token} has a sharing mode, so its cell type is ${arrayBufferCellType} and it names no C++ class`,
  );
}

function hasLockedPrototypeChain({ prototype }: ModelClass): boolean {
  let holder: ModelBuiltin | null = prototype;
  while (holder !== null) {
    holder = holder.sameObjectAs ?? holder;
    if (!holder.flags.includes("IsLockedObject") && !holder.flags.includes("HasLockedMembers")) return false;
    if (holder.prototype.link === "Null") return true;
    holder = holder.prototype.link === "Builtin" ? holder.prototype.builtin : null;
  }
  return false;
}

// The compiler takes a new instance of such a class for pristine and expects a change of the instance to clear the mark of its Structure, so start-up has to find the Structure.
function checkInstanceStructure(builtinClass: ModelClass, problems: Problems): void {
  if (builtinClass.origin !== "Host" || builtinClass.isPrimitiveWrapper || builtinClass.isNeverPristine) return;
  if (builtinClass.instanceStructureCppExpression !== null || !hasLockedPrototypeChain(builtinClass)) return;
  problems.add(
    null,
    `every prototype of the class ${builtinClass.token} is locked, so it names the Structure of its instances (instanceStructureCppExpression) or is never pristine`,
  );
}

export function checkInstanceTests(model: Pick<TableModel, "classes">, problems: Problems): void {
  for (const builtinClass of model.classes) {
    checkSharingMode(builtinClass, problems);
    checkInstanceStructure(builtinClass, problems);
  }

  const classesByCellType = Map.groupBy(model.classes.filter(readsCellType), ({ jsType }) => jsType);
  for (const [cellType, classes] of classesByCellType) {
    for (const [position, first] of classes.entries()) {
      for (const second of classes.slice(position + 1)) {
        if (extendsClass(first, second) || extendsClass(second, first)) continue;
        if (haveDifferentSharingModes(first, second)) continue;
        problems.add(
          null,
          `the instance tests of ${first.token} and ${second.token} both pass for a cell of type ${cellType}, and neither class extends the other`,
        );
      }
    }
  }
}
