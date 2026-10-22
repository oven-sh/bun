import type { Problems } from "./declarations.ts";
import { DependencyClosure, type RuntimeDependencies } from "./dependency-closure.ts";
import type { ModelFunction, ModelModule, TableModel } from "./model.ts";

const maximumHostFunctionCount = 20;
const undeclaredNativeCode = "%UndeclaredNativeCode%";

const describeFunction = ({ file, exportName }: ModelFunction): string => `${exportName} of ${file}`;

function hostFunctionsOf({ calls, implementedBy }: RuntimeDependencies): ModelFunction[] {
  return [...calls.union(implementedBy)]
    .filter(({ role }) => role === "HostBuiltin")
    .sort((left, right) => left.id - right.id);
}

function checkLoadsNothing(dependencies: RuntimeDependencies, consequence: string, problems: Problems): void {
  const modules = [...dependencies.loads.keys()].sort((left: ModelModule, right: ModelModule) => left.id - right.id);
  for (const module of modules) {
    problems.add(null, `${dependencies.namedBy.get(module)?.text} loads ${module.specifier}, and ${consequence}`);
  }
}

function checkHostFunctionCount(dependencies: RuntimeDependencies, owner: string, problems: Problems): void {
  const functions = hostFunctionsOf(dependencies);
  if (functions.length <= maximumHostFunctionCount) return;
  const named = functions.map(
    called => `  ${describeFunction(called)}, for ${dependencies.namedBy.get(called)?.text}\n`,
  );
  problems.add(
    null,
    `${owner} needs ${functions.length} of Bun's own functions, more than ${maximumHostFunctionCount}:\n${named.join("")}` +
      "declare the results of the entries that lead to them",
  );
}

function checkUndeclaredNativeCode(model: TableModel, everyProgram: RuntimeDependencies, problems: Problems): void {
  const entry = model.builtins.find(builtin => builtin.text === undeclaredNativeCode);
  if (entry === undefined) {
    problems.add(null, `there is no ${undeclaredNativeCode}`);
    return;
  }
  for (const { function: called } of entry.attachments.calledFunctions) {
    if (everyProgram.calls.has(called)) continue;
    problems.add(
      null,
      `${undeclaredNativeCode} calls ${describeFunction(called)}, and no program mentions that entry: ` +
        "the front end sends the function only if an object of the language leads to it too",
    );
  }
}

export function checkDependencies(model: TableModel, problems: Problems): void {
  const closure = new DependencyClosure(model);
  const undescribedCount = closure.undescribedResults().length;
  const anyHostObject = closure.dependenciesOfAnyHostObject();
  checkLoadsNothing(
    anyHostObject,
    `an instance of a host class leads to it, so each of the ${undescribedCount} entries with a result that is not described would load the module`,
    problems,
  );
  checkHostFunctionCount(anyHostObject, "an instance of any host class", problems);
  const everyProgram = closure.dependenciesOfEveryProgram();
  checkLoadsNothing(
    everyProgram,
    "an object of the language leads to it, so every program would load the module",
    problems,
  );
  checkHostFunctionCount(everyProgram, "every program", problems);
  checkUndeclaredNativeCode(model, everyProgram, problems);
}

export function describeUndescribedResults(model: TableModel): string {
  return new DependencyClosure(model)
    .undescribedResults()
    .map(({ builtin, reason }) => `${builtin.text}: ${reason}\n`)
    .join("");
}

export function summarizeUndescribedResults(model: TableModel): string {
  const closure = new DependencyClosure(model);
  const { loads, calls, implementedBy } = closure.dependenciesOfAnyHostObject();
  return (
    `${closure.undescribedResults().length} host entries have a result that is not described, ` +
    `and each needs what any host class needs: ${loads.size} modules, ${calls.union(implementedBy).size} functions`
  );
}
