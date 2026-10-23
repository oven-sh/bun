import { isObjectKind, type ModelBuilder } from "./build-entries.ts";
import type { Source } from "./declarations.ts";
import { canonicalTextOf } from "./dump.ts";
import {
  typePartKinds,
  type ModelBound,
  type ModelClass,
  type ModelOperand,
  type ModelSlot,
  type ModelType,
  type ModelTypePart,
} from "./model.ts";
import { compareBytes } from "./paths.ts";
import {
  freshnesses,
  primitives,
  pristineAspects,
  type Bound,
  type ClassName,
  type Freshness,
  type OperandName,
  type Primitive,
  type PristineAspect,
  type SlotName,
  type TypeSpec,
} from "./vocabulary.ts";

export interface OperandScope {
  operandOf(name: OperandName, source: Source): ModelOperand | null;
  classesOf(operand: ModelOperand): readonly ModelClass[];
  resultClasses: readonly ModelClass[];
}

export type Atom = Primitive | "Function" | "OtherObject" | ModelClass;

type ObjectAtom = Exclude<Atom, Primitive>;
type UninternedType = Omit<ModelType, "id" | "key">;
type SpecOf<Type extends TypeSpec["type"]> = Extract<TypeSpec, { type: Type }>;
type CallRelativeSpec = SpecOf<
  | "InstanceOfReceiverClass"
  | "TypedArrayOfReceiverElementType"
  | "Operand"
  | "Slot"
  | "IteratedValues"
  | "CallbackResult"
  | "Prototype"
>;

const functionClassName: ClassName = "Function";
const arrayClassName: ClassName = "Array";
const objectClassName: ClassName = "Object";

const neverType: UninternedType = {
  isAnything: false,
  hasAnyObject: false,
  hasAnyFunction: false,
  hasPlainData: false,
  primitives: [],
  integers: null,
  stringLiterals: [],
  freshness: "No",
  parts: [],
};

interface InstanceGroup {
  class: ModelClass;
  pristine: readonly PristineAspect[];
  isOfClassItself: boolean;
  contents: ReadonlyMap<ModelSlot, TypeSpec>[];
}

class TypeDraft {
  isAnything = false;
  hasAnyObject = false;
  hasAnyFunction = false;
  hasPlainData = false;
  integers: ModelType["integers"] = null;
  readonly primitives = new Set<Primitive>();
  readonly stringLiterals = new Set<string>();
  readonly freshnesses = new Set<Freshness>();
  readonly instances = new Map<string, InstanceGroup>();
  readonly parts: ModelTypePart[] = [];
}

function findSlot(owner: ModelClass, name: SlotName): ModelSlot | undefined {
  return owner.slots.find(slot => slot.name.text === name);
}

function boundOf(bound: Bound): ModelBound {
  return typeof bound === "number"
    ? { value: bound, cppExpression: null }
    : { value: bound.value, cppExpression: bound.cppExpression };
}

function outermostBound(left: ModelBound, right: ModelBound, direction: -1 | 1): ModelBound {
  const difference = (left.value - right.value) * direction;
  if (difference !== 0) return difference > 0 ? left : right;
  return compareBytes(left.cppExpression ?? "", right.cppExpression ?? "") >= 0 ? left : right;
}

function describePart(part: ModelTypePart): object {
  switch (part.part) {
    case "Instance":
      return {
        part: part.part,
        class: part.class.token,
        pristine: part.pristine,
        isOfClassItself: part.isOfClassItself,
        contents: part.contents.map(({ slot, type }) => ({ slot: slot.name.text, type: type.key })),
      };
    case "InstanceOfReceiverClass":
    case "TypedArrayOfReceiverElementType":
      return { part: part.part };
    case "Layout":
      return { part: part.part, layout: part.layout.token };
    case "Builtin":
      return { part: part.part, builtin: part.builtin.path };
    case "Operand":
    case "CallbackResult":
    case "Prototype":
      return { part: part.part, operand: part.operand };
    case "IteratedValues":
      return { part: part.part, operand: part.operand, isSettled: part.isSettled };
    case "Slot":
      return { part: part.part, operand: part.operand, owner: part.slot.owner.token, slot: part.slot.name.text };
  }
}

function sortUniqueParts(parts: readonly ModelTypePart[]): ModelTypePart[] {
  const partsByText = new Map<string, ModelTypePart>();
  for (const part of parts) partsByText.set(canonicalTextOf(describePart(part)), part);
  return [...partsByText]
    .sort(
      ([leftText, left], [rightText, right]) =>
        typePartKinds.indexOf(left.part) - typePartKinds.indexOf(right.part) || compareBytes(leftText, rightText),
    )
    .map(([, part]) => part);
}

export function keyOfType(type: UninternedType): string {
  return canonicalTextOf({
    isAnything: type.isAnything,
    hasAnyObject: type.hasAnyObject,
    hasAnyFunction: type.hasAnyFunction,
    hasPlainData: type.hasPlainData,
    primitives: type.primitives,
    integers: type.integers,
    stringLiterals: type.stringLiterals.map(name => name.text),
    freshness: type.freshness,
    parts: type.parts.map(describePart),
  });
}

export class TypeInterner {
  readonly #builder: ModelBuilder;
  readonly #byKey = new Map<string, ModelType>();
  readonly #all: ModelType[] = [];
  readonly anything: ModelType;
  readonly never: ModelType;

  constructor(builder: ModelBuilder) {
    this.#builder = builder;
    this.anything = this.#store({ ...neverType, isAnything: true });
    this.never = this.#store(neverType);
  }

  get all(): readonly ModelType[] {
    return this.#all;
  }

  intern(spec: TypeSpec, scope: OperandScope | null, source: Source): ModelType {
    const draft = new TypeDraft();
    this.#add(draft, spec, scope, source);
    const freshness = this.#freshnessOf(draft, spec, source);
    if (draft.isAnything) return this.#store({ ...neverType, isAnything: true, freshness });
    const literals = draft.primitives.has("String") ? [] : [...draft.stringLiterals].sort(compareBytes);
    return this.#store({
      isAnything: false,
      hasAnyObject: draft.hasAnyObject,
      hasAnyFunction: draft.hasAnyFunction,
      hasPlainData: draft.hasPlainData,
      primitives: primitives.filter(primitive => draft.primitives.has(primitive)),
      integers: draft.primitives.has("Number") ? null : draft.integers,
      stringLiterals: literals.map(text => this.#builder.internName(text, "Text")),
      freshness,
      parts: sortUniqueParts([...draft.parts, ...this.#instancePartsOf(draft, scope, source)]),
    });
  }

  internAtoms(atoms: readonly Atom[]): ModelType {
    const parts = atoms.flatMap((atom): ModelTypePart[] =>
      typeof atom === "object"
        ? [{ part: "Instance", class: atom, pristine: [], isOfClassItself: false, contents: [] }]
        : [],
    );
    return this.#store({
      ...neverType,
      hasAnyObject: atoms.includes("OtherObject"),
      hasAnyFunction: atoms.includes("Function"),
      primitives: primitives.filter(primitive => atoms.includes(primitive)),
      parts: sortUniqueParts(parts),
    });
  }

  #store(type: UninternedType): ModelType {
    const key = keyOfType(type);
    const existing = this.#byKey.get(key);
    if (existing !== undefined) return existing;
    const interned: ModelType = { ...type, id: this.#all.length, key };
    this.#byKey.set(key, interned);
    this.#all.push(interned);
    const bounds = type.integers === null ? [] : [type.integers.minimum, type.integers.maximum];
    this.#builder.checkedNumbers.push(...bounds.filter(bound => bound.cppExpression !== null));
    return interned;
  }

  #add(draft: TypeDraft, spec: TypeSpec, scope: OperandScope | null, source: Source): void {
    switch (spec.type) {
      case "Union":
        for (const member of spec.members) this.#add(draft, member, scope, source);
        return;
      case "Never":
        return;
      case "Anything":
        draft.isAnything = true;
        draft.freshnesses.add(spec.freshness ?? "No");
        return;
      case "Primitive":
        draft.primitives.add(spec.primitive);
        if (spec.freshness !== undefined) draft.freshnesses.add(spec.freshness);
        return;
      case "Integers":
        this.#addIntegers(draft, spec, source);
        return;
      case "StringLiterals":
        for (const value of spec.values) draft.stringLiterals.add(value);
        return;
      case "Object":
        draft.hasAnyObject = true;
        draft.freshnesses.add(spec.freshness ?? "No");
        return;
      case "Function":
        draft.hasAnyFunction = true;
        draft.freshnesses.add("No");
        return;
      case "PlainData":
        draft.hasPlainData = true;
        return;
      case "Instance":
        this.#addInstance(draft, spec, source);
        return;
      case "Layout":
        this.#addLayout(draft, spec, source);
        return;
      case "Builtin":
        this.#addBuiltin(draft, spec, source);
        return;
      case "InstanceOfReceiverClass":
      case "TypedArrayOfReceiverElementType":
      case "Operand":
      case "Slot":
      case "IteratedValues":
      case "CallbackResult":
      case "Prototype":
        this.#addCallRelativePart(draft, spec, scope, source);
        return;
    }
  }

  #addIntegers(draft: TypeDraft, spec: SpecOf<"Integers">, source: Source): void {
    const minimum = boundOf(spec.minimum);
    const maximum = boundOf(spec.maximum);
    const isRange =
      Number.isSafeInteger(minimum.value) && Number.isSafeInteger(maximum.value) && minimum.value <= maximum.value;
    if (!isRange) {
      this.#builder.problems.add(source, `${minimum.value} to ${maximum.value} is not a range of safe integers`);
      return;
    }
    draft.integers =
      draft.integers === null
        ? { minimum, maximum }
        : {
            minimum: outermostBound(draft.integers.minimum, minimum, -1),
            maximum: outermostBound(draft.integers.maximum, maximum, 1),
          };
  }

  #addInstance(draft: TypeDraft, spec: SpecOf<"Instance">, source: Source): void {
    const instanceClass = this.#builder.resolveClass(spec.class, source);
    if (instanceClass === null) return;
    draft.freshnesses.add(spec.freshness ?? "No");
    const pristine = pristineAspects.filter(aspect => spec.pristine?.includes(aspect));
    const contents = new Map<ModelSlot, TypeSpec>();
    for (const [name, held] of Object.entries(spec.contents ?? {})) {
      const slot = findSlot(instanceClass, name);
      if (slot === undefined) this.#builder.problems.add(source, `class ${instanceClass.token} has no slot "${name}"`);
      else contents.set(slot, held);
    }
    const isOfClassItself = spec.isOfClassItself === true;
    const groupKey = [instanceClass.token, isOfClassItself, ...pristine].join(" ");
    const group = draft.instances.get(groupKey);
    if (group === undefined)
      draft.instances.set(groupKey, { class: instanceClass, pristine, isOfClassItself, contents: [contents] });
    else group.contents.push(contents);
  }

  #addLayout(draft: TypeDraft, spec: SpecOf<"Layout">, source: Source): void {
    const layout = this.#builder.resolveLayout(spec.layout, source);
    if (layout === null) return;
    draft.freshnesses.add(spec.freshness ?? "No");
    draft.parts.push({ part: "Layout", layout });
  }

  #addBuiltin(draft: TypeDraft, spec: SpecOf<"Builtin">, source: Source): void {
    const resolved = this.#builder.resolve(spec.path, source);
    if (resolved === null) return;
    const builtin = resolved.sameObjectAs ?? resolved;
    if (!isObjectKind(builtin.kind)) {
      this.#builder.problems.add(source, `a type can only name an object, and ${builtin.text} is a ${builtin.kind}`);
      return;
    }
    draft.freshnesses.add("No");
    draft.parts.push({ part: "Builtin", builtin });
  }

  #addCallRelativePart(draft: TypeDraft, spec: CallRelativeSpec, scope: OperandScope | null, source: Source): void {
    if (scope === null) {
      this.#builder.problems.add(
        source,
        `${spec.type} describes a value by an operand of a call, so it cannot be part of a parameter, a layout field or a slot: ${canonicalTextOf(spec)}`,
      );
      return;
    }
    if (spec.type === "InstanceOfReceiverClass" || spec.type === "TypedArrayOfReceiverElementType") {
      draft.freshnesses.add(spec.freshness ?? "No");
      draft.parts.push({ part: spec.type });
      return;
    }
    const operand = scope.operandOf(spec.operand, source);
    if (operand === null) return;
    draft.freshnesses.add("No");
    const isSettled = spec.type === "IteratedValues" && spec.isSettled === true;
    if (spec.type === "Slot") this.#addSlotParts(draft, spec, operand, scope.classesOf(operand), source);
    else if (spec.type === "IteratedValues") draft.parts.push({ part: spec.type, operand, isSettled });
    else draft.parts.push({ part: spec.type, operand });
  }

  #addSlotParts(
    draft: TypeDraft,
    spec: SpecOf<"Slot">,
    operand: ModelOperand,
    classes: readonly ModelClass[],
    source: Source,
  ): void {
    if (classes.length === 0) {
      this.#builder.problems.add(
        source,
        `${spec.operand} is not declared as an instance of a class, so it has no slot "${spec.slot}"`,
      );
    }
    for (const owner of classes) {
      const slot = findSlot(owner, spec.slot);
      if (slot === undefined) this.#builder.problems.add(source, `class ${owner.token} has no slot "${spec.slot}"`);
      else draft.parts.push({ part: "Slot", operand, slot });
    }
  }

  #freshnessOf(draft: TypeDraft, spec: TypeSpec, source: Source): Freshness {
    const written = freshnesses.filter(freshness => draft.freshnesses.has(freshness));
    if (written.length > 1) {
      this.#builder.problems.add(
        source,
        `a type has one freshness for every part that may be an object, where a function, a built-in and a value of an operand or a callback have No, and this type has ${written.join(" and ")}: ${canonicalTextOf(spec)}`,
      );
    }
    return written[0] ?? "No";
  }

  #instancePartsOf(draft: TypeDraft, scope: OperandScope | null, source: Source): ModelTypePart[] {
    return Array.from(draft.instances.values(), (group): ModelTypePart => ({
      part: "Instance",
      class: group.class,
      pristine: group.pristine,
      isOfClassItself: group.isOfClassItself,
      contents: group.class.slots.flatMap(slot => {
        const members = group.contents.flatMap(contents => contents.get(slot) ?? []);
        if (members.length < group.contents.length) return [];
        return [{ slot, type: this.intern({ type: "Union", members }, scope, source) }];
      }),
    }));
  }
}

function isOrExtends(candidate: ModelClass, isAncestor: (ancestor: ModelClass) => boolean): boolean {
  const visited = new Set<ModelClass>();
  let current: ModelClass | null = candidate;
  while (current !== null && !visited.has(current)) {
    if (isAncestor(current)) return true;
    visited.add(current);
    current = current.parent;
  }
  return false;
}

const isFunctionClass = (candidate: ModelClass): boolean =>
  isOrExtends(candidate, ancestor => ancestor.token === functionClassName);

function admitsPrimitive(type: ModelType, atom: Primitive): boolean {
  switch (atom) {
    case "Number":
      return type.primitives.includes(atom) || type.integers !== null;
    case "String":
      return type.primitives.includes(atom) || type.stringLiterals.length > 0;
    case "Undefined":
    case "Null":
    case "Boolean":
    case "Symbol":
    case "BigInt":
    case "NotPassed":
      return type.primitives.includes(atom);
  }
}

function flagsAdmit(type: ModelType, atom: ObjectAtom): boolean {
  if (type.hasAnyObject) return true;
  if (atom === "Function") return type.hasAnyFunction;
  if (atom === "OtherObject") return type.hasPlainData;
  if (type.hasAnyFunction && isFunctionClass(atom)) return true;
  return type.hasPlainData && (atom.token === arrayClassName || atom.token === objectClassName);
}

function partAdmits(part: ModelTypePart, atom: ObjectAtom): boolean {
  switch (part.part) {
    case "Instance": {
      if (atom === "OtherObject") return false;
      const instanceClass = part.class;
      if (atom === "Function") return isFunctionClass(instanceClass);
      return isOrExtends(atom, ancestor => ancestor === instanceClass);
    }
    case "Layout":
      if (atom === "Function") return false;
      return atom === "OtherObject" || atom.token === (part.layout.isTuple ? arrayClassName : objectClassName);
    case "Builtin":
      return true;
    case "InstanceOfReceiverClass":
    case "TypedArrayOfReceiverElementType":
    case "Operand":
    case "Slot":
    case "IteratedValues":
    case "CallbackResult":
    case "Prototype":
      return false;
  }
}

function admitsObject(type: ModelType, atom: ObjectAtom): boolean {
  return flagsAdmit(type, atom) || type.parts.some(part => partAdmits(part, atom));
}

export function admits(type: ModelType, atom: Atom): boolean {
  if (type.isAnything) return true;
  if (typeof atom === "object" || atom === "Function" || atom === "OtherObject") return admitsObject(type, atom);
  return admitsPrimitive(type, atom);
}
