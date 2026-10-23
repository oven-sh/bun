import { admits, type Atom } from "./build-types.ts";
import type { Problems } from "./declarations.ts";
import { atomsAt, chooseOverload, describeOperand, parameterAt, takes } from "./dispatch.ts";
import type {
  ModelDispatchNode,
  ModelDispatchTarget,
  ModelOperand,
  ModelOverload,
  ModelParameter,
  ModelType,
  TableModel,
} from "./model.ts";
import { callModes } from "./vocabulary.ts";

const maximumEnumeratedPositions = 4;
const maximumEnumeratedAtoms = 12;
const untestedPositionAtoms: readonly Atom[] = ["Undefined"];

export const describeOverload = (overload: ModelOverload): string =>
  `overload ${overload.indexInBuiltin} of ${overload.builtin.text}`;

const describeAtom = (atom: Atom): string => (typeof atom === "string" ? atom : atom.token);

const longestParameterList = (overloads: readonly ModelOverload[]): number =>
  Math.max(...overloads.map(overload => overload.parameters.length));

function* targetsOf(root: ModelDispatchTarget): Generator<ModelDispatchTarget> {
  const visited = new Set<ModelDispatchNode>();
  const pending = [root];
  for (let target = pending.pop(); target !== undefined; target = pending.pop()) {
    if ("node" in target) {
      if (visited.has(target.node)) continue;
      visited.add(target.node);
      for (const branch of target.node.branches) pending.push(branch.target);
    }
    yield target;
  }
}

export function leavesOf(root: ModelDispatchTarget): Set<ModelOverload> {
  const leaves = new Set<ModelOverload>();
  for (const target of targetsOf(root)) {
    if ("overload" in target) leaves.add(target.overload);
  }
  return leaves;
}

function positionsOf(argumentCount: number): ModelOperand[] {
  const positions: ModelOperand[] = [{ operand: "Receiver" }];
  for (let index = 0; index < argumentCount; index++) positions.push({ operand: "Argument", index });
  return positions;
}

function testedAtomsAt(overloads: readonly ModelOverload[], position: ModelOperand): readonly Atom[] {
  const isTested = overloads.some(overload => {
    const parameter = parameterAt(overload, position);
    return parameter !== null && !parameter.accepted.isAnything;
  });
  return isTested ? atomsAt(overloads, position) : untestedPositionAtoms;
}

export function kindVectors(overloads: readonly ModelOverload[], limit: number): Atom[][] {
  let vectors: Atom[][] = [[]];
  for (const position of positionsOf(limit)) {
    const atoms = testedAtomsAt(overloads, position);
    vectors = vectors.flatMap(vector => atoms.map(atom => [...vector, atom]));
  }
  return vectors;
}

function atomIn(vector: readonly Atom[], operand: ModelOperand): Atom {
  return operand.operand === "Receiver" ? vector[0] : (vector[operand.index + 1] ?? "NotPassed");
}

function checkReachability(overloads: readonly ModelOverload[], root: ModelDispatchTarget, problems: Problems): void {
  const leaves = leavesOf(root);
  for (const overload of overloads) {
    if (leaves.has(overload)) continue;
    problems.add(
      overload.source,
      `${describeOverload(overload)} is never chosen: the ones before it take every call it would`,
    );
  }
}

function isNarrowFor(type: ModelType, atom: Atom): boolean {
  if (atom === "Number") return type.integers !== null;
  if (atom === "String") return type.stringLiterals.length > 0;
  const unrestrictedParts = type.parts.filter(
    part => part.part !== "Instance" || (part.pristine.length === 0 && part.contents.length === 0),
  );
  return !admits({ ...type, parts: unrestrictedParts }, atom);
}

function narrowAtomsOf(parameter: ModelParameter | null, atoms: readonly Atom[]): Atom[] {
  if (parameter === null || parameter.conversion !== "None") return [];
  const { accepted } = parameter;
  return atoms.filter(atom => admits(accepted, atom) && isNarrowFor(accepted, atom));
}

function takesEveryValue(parameter: ModelParameter | null, atom: Atom): boolean {
  return takes(parameter, atom) && narrowAtomsOf(parameter, [atom]).length === 0;
}

function takesEveryIntegerOf(later: ModelParameter, earlier: ModelParameter | null): boolean {
  const [outer, inner] = [later.accepted.integers, earlier?.accepted.integers ?? null];
  if (outer === null || inner === null || earlier?.conversion !== "None") return false;
  return outer.minimum.value <= inner.minimum.value && inner.maximum.value <= outer.maximum.value;
}

function coversParameter(
  later: ModelParameter | null,
  earlier: ModelParameter | null,
  atoms: readonly Atom[],
): boolean {
  if (later === null) return true;
  const isSameParameter =
    earlier !== null &&
    later.accepted === earlier.accepted &&
    later.conversion === earlier.conversion &&
    later.refused === earlier.refused;
  const takesAllOf = (atom: Atom) =>
    takesEveryValue(later, atom) || (atom === "Number" && takesEveryIntegerOf(later, earlier));
  return isSameParameter || atoms.every(atom => !takes(earlier, atom) || takesAllOf(atom));
}

function checkNarrowTypes(overloads: readonly ModelOverload[], problems: Problems): void {
  const positions = positionsOf(longestParameterList(overloads)).map(position => ({
    position,
    atoms: testedAtomsAt(overloads, position),
  }));
  for (const [index, overload] of overloads.entries()) {
    if (overload.proof === "ByConstruction") continue;
    let candidates = overloads.slice(index + 1);
    for (const { position, atoms } of positions) {
      const parameter = parameterAt(overload, position);
      const untaken = narrowAtomsOf(parameter, atoms).filter(
        atom => !candidates.some(candidate => takesEveryValue(parameterAt(candidate, position), atom)),
      );
      if (untaken.length > 0) {
        problems.add(
          overload.source,
          `${describeOverload(overload)} takes only some values of ${untaken.map(describeAtom).join(", ")} as ${describeOperand(position)}, and no later ${overload.mode} overload with the same earlier operands takes the rest`,
        );
      }
      candidates = candidates.filter(candidate => coversParameter(parameterAt(candidate, position), parameter, atoms));
    }
  }
}

function checkUndeclaredOverload(overloads: readonly ModelOverload[], problems: Problems): void {
  const [undeclared, ...others] = overloads.filter(overload => overload.flags.includes("IsUndeclared"));
  for (const other of others) {
    problems.add(other.source, `${describeOverload(other)} is the second undeclared ${other.mode} overload`);
  }
  if (undeclared === undefined || undeclared === overloads.at(-1)) return;
  problems.add(
    undeclared.source,
    `${describeOverload(undeclared)} is undeclared, so it is the last ${undeclared.mode} overload`,
  );
}

function isEnumerable(overloads: readonly ModelOverload[], argumentCount: number): boolean {
  const sizes = positionsOf(argumentCount).map(position => testedAtomsAt(overloads, position).length);
  const testedPositionCount = sizes.filter(size => size > 1).length;
  return testedPositionCount <= maximumEnumeratedPositions && Math.max(...sizes) <= maximumEnumeratedAtoms;
}

function checkTotality(overloads: readonly ModelOverload[], root: ModelDispatchTarget, problems: Problems): void {
  if ("overload" in root) return;
  const [{ builtin, mode, source }] = overloads;
  let isTotal = true;
  for (const target of targetsOf(root)) {
    if ("overload" in target || target.node.branches.at(-1)?.tested.isAnything) continue;
    isTotal = false;
    problems.add(
      source,
      `${builtin.text}: the last branch of the ${mode} dispatch node on ${describeOperand(target.node.operand)} does not test anything`,
    );
  }
  const argumentCount = longestParameterList(overloads);
  if (!isTotal || !isEnumerable(overloads, argumentCount)) return;
  const unrelated = new Set<ModelOverload>();
  for (const vector of kindVectors(overloads, argumentCount)) {
    const chosen = chooseOverload(root, operand => atomIn(vector, operand));
    if (!overloads.includes(chosen)) unrelated.add(chosen);
  }
  for (const overload of unrelated) {
    problems.add(
      source,
      `${builtin.text}: its ${mode} dispatch reaches ${describeOverload(overload)}, which is not one of its ${mode} overloads`,
    );
  }
}

// A call passes no argument after the first optional parameter that it leaves out.
function checkParameterOrder(overloads: readonly ModelOverload[], problems: Problems): void {
  for (const overload of overloads) {
    const firstOptional = overload.parameters.findIndex(parameter => parameter.mode !== "Required");
    if (firstOptional === -1) continue;
    const required = overload.parameters.slice(firstOptional).find(parameter => parameter.mode === "Required");
    if (required === undefined) continue;
    problems.add(
      overload.source,
      `${describeOverload(overload)} requires ${required.name} after ${overload.parameters[firstOptional].name}, which a call may leave out`,
    );
  }
}

// Placement plans the cell of a layout from the allocations in compiled code. A function of the engine or of the host makes an ordinary object with the same properties.
export function checkResultLayouts(overloads: readonly ModelOverload[], problems: Problems): void {
  for (const overload of overloads) {
    const isCompiled = overload.code.implementation.how === "Compiled";
    for (const { layout, isOrdinaryObject } of overload.result.layouts) {
      if (layout.isTuple) {
        if (!isOrdinaryObject) continue;
        problems.add(
          overload.source,
          `${describeOverload(overload)} returns the tuple ${layout.token}, which is an array`,
        );
      } else if (isCompiled && isOrdinaryObject) {
        problems.add(
          overload.source,
          `${describeOverload(overload)} is compiled, so it allocates the layout: b.layoutOf("${layout.token}")`,
        );
      } else if (!isCompiled && !isOrdinaryObject) {
        problems.add(
          overload.source,
          `${describeOverload(overload)} is not compiled, so nothing allocates the layout: b.ordinaryObjectOf("${layout.token}")`,
        );
      }
    }
  }
}

function checkSpecialCases(overloads: readonly ModelOverload[], problems: Problems): void {
  const positions = positionsOf(longestParameterList(overloads)).map(position => ({
    position,
    atoms: testedAtomsAt(overloads, position),
  }));
  for (const [index, overload] of overloads.entries()) {
    if (!overload.flags.includes("IsSpecialCase")) continue;
    const general = overloads[index + 1];
    if (general === undefined) {
      problems.add(
        overload.source,
        `${describeOverload(overload)} is a special case, and no ${overload.mode} overload follows it`,
      );
      continue;
    }
    for (const { position, atoms } of positions) {
      if (coversParameter(parameterAt(general, position), parameterAt(overload, position), atoms)) continue;
      problems.add(
        overload.source,
        `${describeOverload(overload)} is a special case of the next overload, which does not take all it takes as ${describeOperand(position)}`,
      );
    }
  }
}

// The function object of an entry that a function of the library implements runs that function.
function checkHostCallees(overloads: readonly ModelOverload[], problems: Problems): void {
  for (const overload of overloads) {
    const { implementation } = overload.code;
    const called = implementation.how === "Inline" ? implementation.otherwise : implementation;
    if (called === null || called.how !== "HostCall" || called.function === null || called.callee === "Function")
      continue;
    problems.add(
      overload.source,
      `${describeOverload(overload)} calls a ${called.callee}, and ${called.function.name} of ${called.function.file} implements the entry: constructorCallee: "Function"`,
    );
  }
}

export function checkOverloads(model: TableModel, problems: Problems): void {
  const dispatchesByBuiltin = Map.groupBy(model.dispatches, dispatch => dispatch.builtin);
  for (const builtin of model.builtins) {
    for (const mode of callModes) {
      const overloads = builtin.overloads.filter(overload => overload.mode === mode);
      if (overloads.length === 0) continue;
      const root = dispatchesByBuiltin.get(builtin)?.find(dispatch => dispatch.mode === mode)?.root;
      if (root === undefined) {
        problems.add(overloads[0].source, `${builtin.text} has ${mode} overloads and no dispatch tree`);
        continue;
      }
      checkParameterOrder(overloads, problems);
      checkResultLayouts(overloads, problems);
      checkHostCallees(overloads, problems);
      checkReachability(overloads, root, problems);
      checkNarrowTypes(overloads, problems);
      checkSpecialCases(overloads, problems);
      checkUndeclaredOverload(overloads, problems);
      checkTotality(overloads, root, problems);
    }
  }
}
