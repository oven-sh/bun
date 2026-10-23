import type { ModelBuilder } from "./build-entries.ts";
import { admits, type Atom, type TypeInterner } from "./build-types.ts";
import { GeneratorError, type DispatchDeclaration, type Problems, type Source } from "./declarations.ts";
import type {
  ModelBuiltin,
  ModelClass,
  ModelDispatch,
  ModelDispatchBranch,
  ModelDispatchTarget,
  ModelOperand,
  ModelOverload,
  ModelParameter,
  ModelType,
} from "./model.ts";
import { compareBytes } from "./paths.ts";
import { callModes, primitives, type CallMode, type Primitive } from "./vocabulary.ts";

const maximumArgumentIndex = 255;

const primitiveAtoms: readonly Primitive[] = [
  "NotPassed",
  ...primitives.filter(primitive => primitive !== "NotPassed"),
];

type DispatchNodeDeclaration = Exclude<DispatchDeclaration, { signature: number }>;

interface Position {
  operand: ModelOperand;
  atoms: readonly Atom[];
}

interface PendingBranch {
  atoms: Atom[];
  target: ModelDispatchTarget;
}

interface DeclaredDispatch {
  mode: CallMode;
  root: DispatchDeclaration;
  source: Source;
}

export function describeOperand(operand: ModelOperand): string {
  switch (operand.operand) {
    case "Receiver":
      return "the receiver";
    case "Argument":
      return `argument ${operand.index}`;
    case "ArgumentsFrom":
      return `the arguments from ${operand.index}`;
  }
}

export function isSameOperand(left: ModelOperand, right: ModelOperand): boolean {
  if (left.operand === "Receiver" || right.operand === "Receiver") return left.operand === right.operand;
  return left.operand === right.operand && left.index === right.index;
}

function coversArgument(operand: ModelOperand, index: number): boolean {
  switch (operand.operand) {
    case "Receiver":
      return false;
    case "Argument":
      return operand.index === index;
    case "ArgumentsFrom":
      return operand.index <= index;
  }
}

export function parameterAt(overload: ModelOverload, operand: ModelOperand): ModelParameter | null {
  if (operand.operand === "Receiver") return overload.receiver;
  return overload.parameters.find(parameter => coversArgument(parameter.operand, operand.index)) ?? null;
}

function ancestorsOf(derived: ModelClass): ModelClass[] {
  const ancestors: ModelClass[] = [];
  let parent = derived.parent;
  while (parent !== null && parent !== derived && !ancestors.includes(parent)) {
    ancestors.push(parent);
    parent = parent.parent;
  }
  return ancestors;
}

function classesNamedIn(type: ModelType): ModelClass[] {
  return type.parts.flatMap(part => (part.part === "Instance" ? [part.class] : []));
}

export function atomsAt(overloads: readonly ModelOverload[], operand: ModelOperand): Atom[] {
  const named = new Set<ModelClass>();
  for (const overload of overloads) {
    const parameter = parameterAt(overload, operand);
    if (parameter === null) continue;
    for (const type of [parameter.accepted, parameter.refused]) {
      for (const namedClass of classesNamedIn(type)) named.add(namedClass);
    }
  }
  const mostDerivedFirst = [...named].sort(
    (left, right) => ancestorsOf(right).length - ancestorsOf(left).length || compareBytes(left.token, right.token),
  );
  return [...primitiveAtoms, ...mostDerivedFirst, "Function", "OtherObject"];
}

function positionsOf(overloads: readonly ModelOverload[]): Position[] {
  const testsReceiver = overloads.some(({ receiver }) => receiver !== null && !receiver.accepted.isAnything);
  const argumentCount = Math.max(...overloads.map(overload => overload.parameters.length));
  const operands: ModelOperand[] = testsReceiver ? [{ operand: "Receiver" }] : [];
  for (let index = 0; index < argumentCount; index++) operands.push({ operand: "Argument", index });
  return operands.map(operand => ({ operand, atoms: atomsAt(overloads, operand) }));
}

export function takes(parameter: ModelParameter | null, atom: Atom): boolean {
  if (parameter === null || admits(parameter.accepted, atom)) return true;
  if (parameter.mode === "Rest" && atom === "NotPassed") return true;
  return parameter.conversion !== "None" && !admits(parameter.refused, atom);
}

function takersOf(candidates: readonly ModelOverload[], operand: ModelOperand, atom: Atom): readonly ModelOverload[] {
  const takers = candidates.filter(candidate => takes(parameterAt(candidate, operand), atom));
  if (takers.length > 0) return takers;
  return atom === "NotPassed" ? takersOf(candidates, operand, "Undefined") : candidates;
}

class DispatchTree {
  readonly #overloads: readonly ModelOverload[];
  readonly #types: TypeInterner;
  readonly #positions: readonly Position[];
  readonly #anyFunction: ModelType;
  readonly #leaves = new Map<ModelOverload, ModelDispatchTarget>();
  readonly #targets = new Map<string, ModelDispatchTarget>();
  #nodeCount = 0;

  constructor(overloads: readonly ModelOverload[], types: TypeInterner) {
    this.#overloads = overloads;
    this.#types = types;
    this.#positions = positionsOf(overloads);
    this.#anyFunction = types.internAtoms(["Function"]);
  }

  get root(): ModelDispatchTarget {
    return this.#step(this.#overloads, 0);
  }

  #leafOf(overload: ModelOverload): ModelDispatchTarget {
    const existing = this.#leaves.get(overload);
    if (existing !== undefined) return existing;
    const leaf: ModelDispatchTarget = { overload };
    this.#leaves.set(overload, leaf);
    return leaf;
  }

  #createNode(operand: ModelOperand, branches: readonly ModelDispatchBranch[]): ModelDispatchTarget {
    return { node: { id: this.#nodeCount++, operand, branches } };
  }

  #covers(outer: Atom, inner: Atom): boolean {
    if (inner === "Function") return outer === "OtherObject";
    if (typeof inner === "string") return false;
    if (outer === "OtherObject") return true;
    if (outer === "Function") return admits(this.#anyFunction, inner);
    return typeof outer === "object" && ancestorsOf(inner).includes(outer);
  }

  #step(candidates: readonly ModelOverload[], positionIndex: number): ModelDispatchTarget {
    if (candidates.length === 1) return this.#leafOf(candidates[0]);
    const key = `${candidates.map(candidate => this.#overloads.indexOf(candidate))} ${positionIndex}`;
    const existing = this.#targets.get(key);
    if (existing !== undefined) return existing;
    const target =
      positionIndex === this.#positions.length
        ? this.#dispatchByNarrowTypes(candidates)
        : this.#dispatchByKind(candidates, positionIndex);
    this.#targets.set(key, target);
    return target;
  }

  #dispatchByKind(candidates: readonly ModelOverload[], positionIndex: number): ModelDispatchTarget {
    const { operand, atoms } = this.#positions[positionIndex];
    const targets = atoms.map(atom => this.#step(takersOf(candidates, operand, atom), positionIndex + 1));
    const fallback = targets[atoms.indexOf("OtherObject")];
    const pending: PendingBranch[] = [];
    atoms.forEach((atom, atomIndex) => {
      const target = targets[atomIndex];
      const reachesFallback = atoms.every(
        (outer, outerIndex) => !this.#covers(outer, atom) || targets[outerIndex] === fallback,
      );
      if (target === fallback && reachesFallback) return;
      const lastConflict = pending.findLastIndex(
        branch => branch.target !== target && branch.atoms.some(inner => this.#covers(atom, inner)),
      );
      const joined = pending.find((branch, branchIndex) => branchIndex > lastConflict && branch.target === target);
      if (joined === undefined) pending.push({ atoms: [atom], target });
      else joined.atoms.push(atom);
    });
    if (pending.length === 0) return fallback;
    return this.#createNode(operand, [
      ...pending.map(branch => ({ tested: this.#types.internAtoms(branch.atoms), target: branch.target })),
      { tested: this.#types.anything, target: fallback },
    ]);
  }

  #isNarrow(parameter: ModelParameter): boolean {
    if (parameter.conversion !== "None" || parameter.accepted.isAnything) return false;
    if (parameter.mode === "Rest") return true;
    const atoms = this.#positions.find(position => isSameOperand(position.operand, parameter.operand))?.atoms ?? [];
    const admitted = atoms.filter(atom => admits(parameter.accepted, atom));
    const widest = admitted.filter(inner => !admitted.some(outer => this.#covers(outer, inner)));
    return parameter.accepted !== this.#types.internAtoms(widest);
  }

  #dispatchByNarrowTypes(candidates: readonly ModelOverload[]): ModelDispatchTarget {
    const [candidate, ...others] = candidates;
    const { receiver, parameters } = candidate;
    const operands: readonly ModelParameter[] = receiver === null ? parameters : [receiver, ...parameters];
    const narrow = operands.filter(parameter => this.#isNarrow(parameter));
    if (narrow.length === 0) return this.#leafOf(candidate);
    const otherwise = this.#step(others, this.#positions.length);
    return narrow.reduceRight(
      (target, parameter) =>
        this.#createNode(parameter.operand, [
          { tested: parameter.accepted, target },
          { tested: this.#types.anything, target: otherwise },
        ]),
      this.#leafOf(candidate),
    );
  }
}

export function dispatchOn(
  overloads: readonly ModelOverload[],
  types: TypeInterner,
  _problems: Problems,
): ModelDispatchTarget {
  if (overloads.length === 0) throw new GeneratorError("a dispatch needs at least one overload");
  if (overloads.length === 1) return { overload: overloads[0] };
  return new DispatchTree(overloads, types).root;
}

export function dispatchFromDeclaration(
  root: DispatchDeclaration,
  overloads: readonly ModelOverload[],
  types: TypeInterner,
  source: Source,
): ModelDispatchTarget {
  const converted = new Map<DispatchDeclaration, ModelDispatchTarget>();
  let nodeCount = 0;

  function convertLeaf(signature: number): ModelDispatchTarget {
    const overload = overloads[signature];
    if (overload !== undefined) return { overload };
    throw new GeneratorError(`${source.file}: a dispatch names signature ${signature} of ${overloads.length}`);
  }

  function convertNode({ argument, branches }: DispatchNodeDeclaration): ModelDispatchTarget {
    const id = nodeCount++;
    return {
      node: {
        id,
        operand: { operand: "Argument", index: argument },
        branches: branches.map(({ tested, then }) => ({
          tested: types.intern(tested, null, source),
          target: convert(then),
        })),
      },
    };
  }

  function convert(declaration: DispatchDeclaration): ModelDispatchTarget {
    const existing = converted.get(declaration);
    if (existing !== undefined) return existing;
    const target = "signature" in declaration ? convertLeaf(declaration.signature) : convertNode(declaration);
    converted.set(declaration, target);
    return target;
  }

  return convert(root);
}

function atomsPassedAt(operand: ModelOperand, atoms: (operand: ModelOperand) => Atom): Atom[] {
  if (operand.operand !== "ArgumentsFrom") return [atoms(operand)];
  const passed: Atom[] = [];
  for (let index = operand.index; index <= maximumArgumentIndex; index++) {
    const atom = atoms({ operand: "Argument", index });
    if (atom === "NotPassed") break;
    passed.push(atom);
  }
  return passed;
}

export function chooseOverload(root: ModelDispatchTarget, atoms: (operand: ModelOperand) => Atom): ModelOverload {
  let target = root;
  while ("node" in target) {
    const { operand, branches } = target.node;
    const passed = atomsPassedAt(operand, atoms);
    const taken = branches.find(branch => passed.every(atom => admits(branch.tested, atom)));
    if (taken === undefined) {
      throw new GeneratorError(`the dispatch node on ${describeOperand(operand)} has no branch that tests anything`);
    }
    target = taken.target;
  }
  return target.overload;
}

function collectDeclaredDispatches(builder: ModelBuilder): Map<ModelBuiltin, DeclaredDispatch[]> {
  const declared = new Map<ModelBuiltin, DeclaredDispatch[]>();
  for (const { declaration, source } of builder.declarations) {
    if (declaration.declares !== "Member" || declaration.dispatches.length === 0) continue;
    const builtin = builder.resolve(declaration.path, source);
    if (builtin === null) continue;
    const dispatches = declaration.dispatches.map(({ mode, root }) => ({ mode, root, source }));
    declared.set(builtin, [...(declared.get(builtin) ?? []), ...dispatches]);
  }
  return declared;
}

export function buildDispatches(builder: ModelBuilder, types: TypeInterner): void {
  const declared = collectDeclaredDispatches(builder);
  const dispatches: ModelDispatch[] = [];
  for (const builtin of builder.builtins) {
    for (const mode of callModes) {
      const overloads = builtin.overloads.filter(overload => overload.mode === mode);
      if (overloads.length === 0) continue;
      const describedAs = builder.bindingsOfFunctions.get(builtin) ?? builtin;
      // A dispatch goes with the signatures of its file, in whose place there may be some that are written by hand.
      const written = declared
        .get(describedAs)
        ?.find(
          dispatch => dispatch.mode === mode && overloads.every(({ source }) => source.file === dispatch.source.file),
        );
      const root =
        written === undefined
          ? dispatchOn(overloads, types, builder.problems)
          : dispatchFromDeclaration(written.root, overloads, types, written.source);
      dispatches.push({ builtin, mode, root });
    }
  }
  builder.dispatches = dispatches;
}
