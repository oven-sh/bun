import * as b from "bun-builtins-table";

// NodeFSStatBinding.cpp getDateField(): it reads `<name>Ms` off the object that it is entered with, makes a Date of it and puts the Date on that object under its own name, whatever the object is.
const date = (name: string) =>
  ({
    this: b.any,
    getter: b.union(b.instance("Date"), b.undefined),
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: {
      this: [b.runsTransitively(b.named(`${name}Ms`), "ToPrimitive"), b.definesName([name], b.instance("Date"))],
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

const stats = (name: string, structure: string) =>
  b.class(`%${name}%`, {
    prototypeCppExpression: `globalObject->${structure}.prototypeInitializedOnMainThread(globalObject)`,
    usesFeature: "FsStats",
    call: b.otherwise,
    construct: b.otherwise,
    proto: { atime: date("atime"), mtime: date("mtime"), ctime: date("ctime"), birthtime: date("birthtime") },
  });

export default b.declarations(
  stats("Stats", "m_JSStatsClassStructure"),
  stats("BigIntStats", "m_JSStatsBigIntClassStructure"),
);
