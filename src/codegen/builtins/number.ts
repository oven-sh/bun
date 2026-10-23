import type { ModelBuilder } from "./build-entries.ts";
import type { TypeInterner } from "./build-types.ts";
import { GeneratorError, type Problems } from "./declarations.ts";
import {
  nameKinds,
  type ModelBound,
  type ModelBuiltin,
  type ModelClass,
  type ModelClosedKeys,
  type ModelDispatch,
  type ModelDispatchNode,
  type ModelDispatchTarget,
  type ModelFunction,
  type ModelName,
  type ModelOverload,
  type ModelProtocolKeys,
  type ModelSlot,
  type ModelType,
  type TableModel,
} from "./model.ts";
import { compareBytes, globalThisPath, joinPath, parsePath, qualifiedTokenOf, tokenOf } from "./paths.ts";
import {
  callModes,
  iteratorRootClasses,
  namesProbedOnIterators,
  protocolKeys,
  protocols,
  protocolsProbedOnAnyObject,
  textsOfPrimitiveKeys,
  type CallMode,
  type KeyedProtocol,
  type Protocol,
} from "./vocabulary.ts";

const shortIdCapacity = 65533;

export const idLimits: {
  builtins: number;
  names: number;
  overloads: number;
  classes: number;
  slots: number;
  layouts: number;
  types: number;
  dispatchNodes: number;
  modules: number;
} = {
  builtins: shortIdCapacity,
  names: shortIdCapacity,
  overloads: shortIdCapacity,
  classes: shortIdCapacity,
  slots: shortIdCapacity,
  layouts: shortIdCapacity,
  types: shortIdCapacity,
  dispatchNodes: shortIdCapacity,
  modules: shortIdCapacity,
};

const isKeyedProtocol = (protocol: Protocol): protocol is KeyedProtocol =>
  protocol !== "Named" && protocol !== "CallsNamed";
const compareIds = (left: { id: number }, right: { id: number }): number => left.id - right.id;
const compareTokens = (left: { token: string }, right: { token: string }): number =>
  compareBytes(left.token, right.token);
const compareModes = (left: { mode: CallMode }, right: { mode: CallMode }): number =>
  callModes.indexOf(left.mode) - callModes.indexOf(right.mode);
const compareNames = (left: ModelName, right: ModelName): number =>
  nameKinds.indexOf(left.kind) - nameKinds.indexOf(right.kind) || compareBytes(left.text, right.text);
const compareDispatches = (left: ModelDispatch, right: ModelDispatch): number =>
  compareIds(left.builtin, right.builtin) || compareModes(left, right);

function assignIds<Item extends { id: number }>(ordered: Item[]): readonly Item[] {
  ordered.forEach((item, id) => {
    item.id = id;
  });
  return Object.freeze(ordered);
}

function internProtocolKeys(builder: ModelBuilder): readonly ModelProtocolKeys[] {
  return Object.freeze(
    protocols.filter(isKeyedProtocol).map(protocol => ({
      protocol,
      keys: Object.freeze(protocolKeys[protocol].map(key => builder.internComponent(key))),
    })),
  );
}

function numberNames(names: Iterable<ModelName>): readonly ModelName[] {
  const ordered = [...names].sort(compareNames);
  ordered.forEach((name, number) => {
    name.number = number;
  });
  return Object.freeze(ordered);
}

function numberBuiltins(builder: ModelBuilder): readonly ModelBuiltin[] {
  const globalObject = builder.find(globalThisPath);
  if (globalObject === undefined) throw new GeneratorError(`no declaration has the path ${globalThisPath}`);
  const membersByHolder = Map.groupBy<ModelBuiltin | null, ModelBuiltin>(builder.builtins, builtin => builtin.holder);
  const hiddenRoots = (membersByHolder.get(null) ?? [])
    .filter(root => root !== globalObject)
    .sort((left, right) => compareBytes(joinPath(left.path), joinPath(right.path)));
  const ordered: ModelBuiltin[] = [globalObject, ...hiddenRoots];
  for (let position = 0; position < ordered.length; position++) {
    const holder = ordered[position];
    const members = (membersByHolder.get(holder) ?? []).sort((left, right) => left.name.number - right.name.number);
    holder.members = Object.freeze(members);
    for (const member of members) ordered.push(member);
  }
  if (ordered.length !== builder.builtins.length) {
    const reached = new Set(ordered);
    for (const builtin of builder.builtins) {
      if (!reached.has(builtin)) builder.problems.add(null, `${builtin.text} is not reachable from a root entry`);
    }
  }
  return assignIds(ordered);
}

const qualifiedPathOf = ({ holder, path }: ModelBuiltin): string[] =>
  holder === null ? [joinPath(path)] : [...holder.path, ...path.slice(-1)];

function assignTokens(builtins: readonly ModelBuiltin[], problems: Problems): void {
  for (const [token, entries] of Map.groupBy(builtins, builtin => tokenOf(builtin.path))) {
    for (const builtin of entries) {
      builtin.token = entries.length === 1 ? token : qualifiedTokenOf(qualifiedPathOf(builtin));
    }
  }
  const owners = new Map<string, ModelBuiltin>();
  for (const builtin of builtins) {
    const owner = owners.get(builtin.token);
    if (owner === undefined) owners.set(builtin.token, builtin);
    else problems.add(null, `${owner.text} and ${builtin.text} both have the token ${builtin.token}`);
  }
}

function numberOverloads(builtins: readonly ModelBuiltin[]): readonly ModelOverload[] {
  const ordered: ModelOverload[] = [];
  for (const builtin of builtins) {
    builtin.overloads = Object.freeze(builtin.overloads.toSorted(compareModes));
    builtin.overloads.forEach((overload, indexInBuiltin) => {
      overload.indexInBuiltin = indexInBuiltin;
      ordered.push(overload);
    });
  }
  return assignIds(ordered);
}

function numberSlots(classes: readonly ModelClass[]): readonly ModelSlot[] {
  return assignIds(classes.flatMap(owner => owner.slots.filter(slot => slot.owner === owner)));
}

function numberTypes(types: TypeInterner): readonly ModelType[] {
  const { anything, never } = types;
  const others = types.all
    .filter(type => type !== anything && type !== never)
    .sort((left, right) => compareBytes(left.key, right.key));
  return assignIds([anything, never, ...others]);
}

function numberDispatchNodes(dispatches: readonly ModelDispatch[]): readonly ModelDispatchNode[] {
  const visited = new Set<ModelDispatchNode>();
  const visit = (target: ModelDispatchTarget): void => {
    if (!("node" in target) || visited.has(target.node)) return;
    visited.add(target.node);
    for (const branch of target.node.branches) visit(branch.target);
  };
  for (const dispatch of dispatches) visit(dispatch.root);
  return assignIds([...visited]);
}

function orderFunctions(functions: Iterable<ModelFunction>): readonly ModelFunction[] {
  const ordered = [...functions].sort(compareIds);
  for (const runtimeFunction of ordered) {
    runtimeFunction.implements = Object.freeze([...new Set(runtimeFunction.implements)].sort(compareIds));
  }
  return Object.freeze(ordered);
}

function orderCheckedNumbers(checkedNumbers: Iterable<ModelBound>): readonly ModelBound[] {
  const boundsByText = new Map<string, ModelBound>();
  for (const bound of checkedNumbers) {
    if (bound.cppExpression === null) continue;
    boundsByText.set(`${bound.cppExpression} ${Object.is(bound.value, -0) ? "-0" : bound.value}`, bound);
  }
  return Object.freeze(
    [...boundsByText].sort(([left], [right]) => compareBytes(left, right)).map(([, bound]) => bound),
  );
}

function checkLimits(model: TableModel, problems: Problems): void {
  for (const list of Object.keys(idLimits) as (keyof typeof idLimits)[]) {
    const count = model[list].length;
    if (count > idLimits[list]) {
      problems.add(null, `the table has ${count} ${list}, more than the ${idLimits[list]} a 16-bit id can number`);
    }
  }
}

function isLockedOutsideLockedObject({ holder, mutability }: ModelBuiltin): boolean {
  return mutability === "AlwaysLocked" && holder !== null && !holder.flags.includes("IsLockedObject");
}

function ancestorsOf(holder: ModelBuiltin): ModelBuiltin[] {
  const ancestors: ModelBuiltin[] = [];
  for (let { prototype } = holder; prototype.link === "Builtin";) {
    const ancestor = prototype.builtin.sameObjectAs ?? prototype.builtin;
    if (ancestors.includes(ancestor)) break;
    ancestors.push(ancestor);
    ({ prototype } = ancestor);
  }
  return ancestors;
}

function hasIteratorInstances({ instanceClass }: ModelBuiltin): boolean {
  for (let current = instanceClass; current !== null; current = current.parent) {
    if (iteratorRootClasses.includes(current.token)) return true;
  }
  return false;
}

function closedKeysOf(
  holder: ModelBuiltin,
  names: readonly ModelName[],
  keysByProtocol: readonly ModelProtocolKeys[],
  openNames: readonly ModelName[],
): ModelClosedKeys {
  const hasObjectInstances = holder.kind === "Prototype" && holder.instanceClass?.isPrimitiveWrapper === false;
  const closed = new Set(names.filter(name => name.kind === "WellKnownSymbol"));
  for (const { protocol, keys } of keysByProtocol) {
    if (!hasObjectInstances || !protocolsProbedOnAnyObject.some(probed => probed === protocol)) continue;
    for (const key of keys) closed.add(key);
  }
  if (holder.kind === "Prototype" || hasIteratorInstances(holder)) {
    for (const name of names) if (name.kind === "Text" && namesProbedOnIterators.includes(name.text)) closed.add(name);
  }
  if (holder.kind === "Prototype") {
    for (const name of names) if (name.kind === "Text" && textsOfPrimitiveKeys.includes(name.text)) closed.add(name);
  }
  for (const ancestor of ancestorsOf(holder)) {
    for (const member of ancestor.members) closed.add(member.name);
  }
  for (const member of holder.members) closed.delete(member.name);
  for (const name of openNames) closed.delete(name);
  const inNumberOrder = (unordered: Iterable<ModelName>): readonly ModelName[] =>
    Object.freeze([...unordered].sort((left, right) => left.number - right.number));
  return { holder, keys: inNumberOrder(closed), openNames: inNumberOrder(openNames) };
}

// A constructor of the engine without a lock of its own is called like every built-in function: `Error.call(this, message)`, `x instanceof Error`.
function isConstructorWithoutLock({ kind, origin, holder, flags, sameObjectAs }: ModelBuiltin): boolean {
  return (
    kind === "Constructor" &&
    (origin === "Engine" || holder?.token === "GlobalThis") &&
    sameObjectAs === null &&
    !flags.includes("HasLockedMembers") &&
    !flags.includes("IsLockedObject")
  );
}

const textsOfNamesOfCalls: readonly string[] = ["call", "apply", "bind"];

function namesOfCallsClosedOn(holder: ModelBuiltin, names: readonly ModelName[]): ModelClosedKeys {
  const keys = names.filter(
    name =>
      (name.kind === "Text"
        ? textsOfNamesOfCalls.includes(name.text)
        : name.kind === "WellKnownSymbol" && name.text === "hasInstance") &&
      !holder.members.some(member => member.name === name),
  );
  return {
    holder,
    keys: Object.freeze([...keys].sort((left, right) => left.number - right.number)),
    openNames: Object.freeze([]),
  };
}

const unfilledRole = "is a role of the host, which code of the engine names, and the host declares no such";

function resolveHostRoles(builder: ModelBuilder): TableModel["hostRoles"] {
  const { unfilledHostRoles } = builder;
  const standIn = unfilledHostRoles === null ? null : builder.resolve(unfilledHostRoles.path, unfilledHostRoles.source);
  return Object.freeze(
    builder.hostRoles.flatMap(({ path, source }) => {
      const builtin = builder.find(path);
      if (builtin === undefined && standIn !== null) return [{ token: tokenOf(parsePath(path)), builtin: standIn }];
      if (builtin === undefined) builder.problems.add(source, `${path} ${unfilledRole} entry`);
      else if (builtin.origin === "Engine")
        builder.problems.add(source, `${path} is an entry of the engine, so it is no role of the host`);
      else if (builtin.token !== tokenOf(builtin.path))
        builder.problems.add(
          source,
          `${path} is a role of the host, and another entry has its token ${tokenOf(builtin.path)}`,
        );
      else return [{ token: builtin.token, builtin }];
      return [];
    }),
  );
}

function resolveHostClassRoles(builder: ModelBuilder): TableModel["hostClassRoles"] {
  const { unfilledHostRoles } = builder;
  const standIn =
    unfilledHostRoles === null ? null : builder.resolveClass(unfilledHostRoles.class, unfilledHostRoles.source);
  return Object.freeze(
    builder.hostClassRoles.flatMap(({ name, source }) => {
      const builtinClass = builder.findClass(name);
      if (builtinClass === undefined && standIn !== null)
        return [{ token: tokenOf(parsePath(name)), builtinClass: standIn }];
      if (builtinClass === undefined) builder.problems.add(source, `${name} ${unfilledRole} class`);
      else if (builtinClass.origin === "Engine")
        builder.problems.add(source, `${name} is a class of the engine, so it is no role of the host`);
      else return [{ token: builtinClass.token, builtinClass }];
      return [];
    }),
  );
}

function collectNamesOfEngine(
  builder: ModelBuilder,
  names: readonly ModelName[],
  builtins: readonly ModelBuiltin[],
  keysByProtocol: readonly ModelProtocolKeys[],
): ReadonlySet<ModelName> {
  const namesOfEngine = new Set<ModelName>(builder.namesDeclaredByEngine);
  for (const name of names) if (name.kind === "WellKnownSymbol") namesOfEngine.add(name);
  for (const builtin of builtins) if (builtin.origin === "Engine") namesOfEngine.add(builtin.name);
  for (const { keys } of keysByProtocol) for (const key of keys) namesOfEngine.add(key);
  for (const text of textsOfPrimitiveKeys) namesOfEngine.add(builder.internComponent(text));
  return namesOfEngine;
}

export function numberModel(builder: ModelBuilder, types: TypeInterner): TableModel {
  const { problems } = builder;
  const internedProtocolKeys = internProtocolKeys(builder);
  for (const text of textsOfPrimitiveKeys) builder.internComponent(text);
  const names = numberNames(builder.names);
  const builtins = numberBuiltins(builder);
  assignTokens(builtins, problems);
  const classes = assignIds([...builder.classes].sort(compareTokens));
  const dispatches = Object.freeze([...builder.dispatches].sort(compareDispatches));
  const model: TableModel = {
    names,
    builtins,
    membersLockedByName: Object.freeze(
      builtins.filter(builtin => isLockedOutsideLockedObject(builtin) && !builder.fixedProperties.has(builtin)),
    ),
    closedKeys: Object.freeze(
      builtins
        .filter(holder => holder.flags.includes("HasLockedMembers") || isConstructorWithoutLock(holder))
        .map(holder =>
          isConstructorWithoutLock(holder)
            ? namesOfCallsClosedOn(holder, names)
            : closedKeysOf(holder, names, internedProtocolKeys, builder.openNames.get(holder) ?? []),
        ),
    ),
    namesReadByNativeCode: Object.freeze(
      builtins.flatMap(holder => {
        const read = builder.namesReadByNativeCode.get(holder);
        if (read === undefined) return [];
        const inNumberOrder = (unordered: readonly ModelName[]): readonly ModelName[] =>
          Object.freeze([...unordered].sort((left, right) => left.number - right.number));
        return [
          { holder, names: inNumberOrder(read.names), namesOnlyInspected: inNumberOrder(read.namesOnlyInspected) },
        ];
      }),
    ),
    overloads: numberOverloads(builtins),
    dispatches,
    dispatchNodes: numberDispatchNodes(dispatches),
    types: numberTypes(types),
    classes,
    slots: numberSlots(classes),
    layouts: assignIds([...builder.layouts].sort(compareTokens)),
    realmStructures: Object.freeze([...builder.realmStructures]),
    modules: Object.freeze([...builder.modules].sort(compareIds)),
    functions: orderFunctions(builder.functions),
    features: Object.freeze([...builder.features]),
    boxedStubs: Object.freeze([...builder.boxedStubs]),
    protocolKeys: internedProtocolKeys,
    hostReads: Object.freeze([...builder.hostReads]),
    namesOfEngine: collectNamesOfEngine(builder, names, builtins, internedProtocolKeys),
    hostRoles: resolveHostRoles(builder),
    hostClassRoles: resolveHostClassRoles(builder),
    hostObjects: Object.freeze([...builder.hostObjects]),
    namedMemberCalls: Object.freeze([...builder.namedMemberCalls]),
    hostMethodCalls: Object.freeze([...builder.hostMethodCalls]),
    checkedNumbers: orderCheckedNumbers(builder.checkedNumbers),
    startup: builder.startup,
    syntax: builder.syntax,
    engineFiles: Object.freeze([...builder.engineFiles]),
  };
  checkLimits(model, problems);
  return model;
}
