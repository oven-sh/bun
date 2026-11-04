import * as b from "bun-builtins-table";
import { datesOfStatsCell } from "./native-cells.ts";

// NodeFSStatBinding.cpp getDateField(): it reads `<name>Ms` off the object that it is entered with, makes a Date of it and puts the Date on that object under its own name, whatever the object is.
const date = (name: string) =>
  ({
    this: b.any,
    getter: b.union(b.instance("Date"), b.undefined),
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: {
      this: [
        b.runsTransitively(b.named(`${name}Ms`), "ToPrimitive"),
        b.createdIn(b.instance("Date").fresh, b.nativeCell(datesOfStatsCell)),
        b.definesName([name], b.nativeCell(datesOfStatsCell)),
        b.returnedFrom(datesOfStatsCell),
      ],
    },
    implementation: b.generic,
    // jsStatsPrototypeFunction_DatePutter.
    setter: {
      this: b.any,
      value: b.any,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      uses: { this: [b.definesName([name], b.operand("value")), ...b.ownPropertyTraps], value: [b.retained] },
      implementation: b.generic,
    },
  }) satisfies b.GetterField;

const testsOfKind = ["isBlockDevice", "isCharacterDevice", "isDirectory", "isFIFO", "isFile", "isSocket", "isSymbolicLink"];
const declareEach = <Declared>(names: readonly string[], declared: Declared) =>
  Object.fromEntries(names.map(name => [name, declared]));

const passedOrUndefined = (name: string) => b.union(b.operand(name), b.undefined);

// modeStatFunction(): it reads `mode` off the object that it is entered with and converts that to a number. What is no object gets undefined.
const testsMode = {
  this: b.any,
  returns: b.union(b.bool, b.undefined),
  capability: "js",
  throws: true,
  runsOnlyOperandCode: true,
  uses: { this: [b.runsTransitively(b.named("mode"), "ToPrimitive")] },
  implementation: b.generic,
} satisfies b.FunctionField;

const times = ["atime", "mtime", "ctime", "birthtime"];
// In the order in which the two constructors take them. The times follow.
const countsOfStats = ["dev", "mode", "nlink", "uid", "gid", "rdev", "blksize", "ino", "size", "blocks"];

// Bun__createJSStatsObject() and Bun__createJSBigIntStatsObject() put numbers of one kind under every name. What a constructor puts there is in its row:
// its operands as they are, and that of BigIntStats converts the four times, which it takes in nanoseconds, and puts numbers under the names that end in `Ms`.
const stats = (name: string, structure: string, held: b.TableType, unitOfOperands: "Ms" | "Ns") => {
  const inUnit = (unit: string) => times.map(time => `${time}${unit}`);
  const convertsTimes = unitOfOperands === "Ns";
  const operands = [...countsOfStats, ...inUnit(unitOfOperands)];
  const names = [...countsOfStats, ...inUnit("Ms"), ...(convertsTimes ? inUnit("Ns") : [])];
  const makesInstance = {
    args: declareEach(operands, b.any.optional),
    returns: b.instance(name).fresh,
    resultProperties: {
      ...Object.fromEntries(operands.map(operand => [operand, passedOrUndefined(operand)])),
      ...(convertsTimes ? declareEach(inUnit("Ms"), b.f64) : {}),
    },
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: {
      ...declareEach(countsOfStats, [b.retained]),
      ...declareEach(inUnit(unitOfOperands), convertsTimes ? [b.retained, b.runs("ToPrimitive")] : [b.retained]),
    },
    implementation: b.generic,
  } satisfies b.FunctionField;
  return b.class(`%${name}%`, {
    prototypeCppExpression: `globalObject->${structure}.prototypeInitializedOnMainThread(globalObject)`,
    usesFeature: "FsStats",
    namesDefinedOnNewInstances: names,
    typesOfNamesDefinedOnNewInstances: b.typesByName(declareEach(names, held)),
    constructorOnlyReadsPrototypeOfNewTarget: true,
    prototypeListsAllMembers: true,
    call: makesInstance,
    construct: makesInstance,
    proto: {
      ...declareEach(testsOfKind, testsMode),
      ...Object.fromEntries(times.map(time => [time, date(time)])),
      "@@toStringTag": b.property(b.string),
    },
  });
};

// NodeDirent.cpp getType(): it looks for the kind of the entry under a private name, on whatever it is entered with and on the objects above that, and looks at what it finds.
const testsKindOfEntry = {
  this: b.any,
  returns: b.bool,
  capability: "js",
  throws: true,
  runsOnlyOperandCode: true,
  uses: { this: [b.runs("PrototypeChain")] },
  implementation: b.generic,
} satisfies b.FunctionField;

export default b.declarations(
  stats("Stats", "m_JSStatsClassStructure", b.f64, "Ms"),
  stats("BigIntStats", "m_JSStatsBigIntClassStructure", b.bigint, "Ns"),
  b.class("%Dirent%", {
    prototypeCppExpression: "globalObject->m_JSDirentClassStructure.prototypeInitializedOnMainThread(globalObject)",
    usesFeature: "FsStats",
    // Bun__Dirent__toJS() puts strings there. What the constructor puts there is in its row.
    namesDefinedOnNewInstances: ["name", "path", "parentPath"],
    typesOfNamesDefinedOnNewInstances: b.typesByName({ name: b.string, path: b.string, parentPath: b.string }),
    constructorOnlyReadsPrototypeOfNewTarget: true,
    prototypeListsAllMembers: true,
    call: { returns: b.never, capability: "heap", throws: true, implementation: b.generic },
    // The kind goes under the private name.
    construct: {
      args: { name: b.any.optional, type: b.any.optional, path: b.any.optional },
      returns: b.instance("Dirent").fresh,
      resultProperties: {
        name: passedOrUndefined("name"),
        path: passedOrUndefined("path"),
        parentPath: passedOrUndefined("path"),
      },
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      uses: { name: [b.retained], type: [b.retained], path: [b.retained] },
      implementation: b.generic,
    },
    proto: { ...declareEach(testsOfKind, testsKindOfEntry), "@@toStringTag": b.property(b.string) },
  }),
);
