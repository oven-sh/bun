import { GeneratorError } from "./declarations.ts";
import {
  emitArray,
  formatAggregate,
  formatDouble,
  formatEnumerator,
  formatId,
  formatName,
  formatOperand,
  formatOptionSet,
  formatUnlessDefault,
  formatUnlessZero,
  joinBlocks,
  Pool,
  wrapFile,
} from "./emit-cpp-support.ts";
import {
  targetArchitectures,
  type ModelBuiltin,
  type ModelCalledFunction,
  type ModelCondition,
  type ModelFeatureUse,
  type ModelHostCall,
  type ModelHostMethodCall,
  type ModelHostObject,
  type ModelHostUse,
  type ModelHostUses,
  type ModelHostValue,
  type ModelImplementation,
  type ModelModuleLoad,
  type ModelName,
  type ModelNamedMemberCall,
  type ModelOverload,
  type TableFeature,
  type TableModel,
} from "./model.ts";
import { targetPlatforms, type FeatureName } from "./vocabulary.ts";

// A use names a call and a call lists the uses of what it answers, so each is a constant of its own that follows what it names.
class HostUseConstants {
  readonly #definitions: string[] = [];
  readonly #names = new Map<string, string>();

  #define(prefix: string, value: string, declare: (name: string) => string): string {
    let name = this.#names.get(`${prefix} ${value}`);
    if (name === undefined) {
      name = `${prefix}${this.#names.size}`;
      this.#names.set(`${prefix} ${value}`, name);
      this.#definitions.push(`static constexpr ${declare(name)} = ${value};`);
    }
    return name;
  }

  addCall(call: string): string {
    return `&${this.#define("hostCall", call, name => `BuiltinHostCall ${name}`)}`;
  }

  addList(uses: readonly string[]): string | null {
    if (uses.length === 0) return null;
    return this.#define(
      "hostUses",
      `{\n${uses.map(use => `    ${use},`).join("\n")}\n}`,
      name => `BuiltinHostUse ${name}[]`,
    );
  }

  emit(): string {
    return this.#definitions.join("\n");
  }
}

interface AttachmentContext {
  names: Pool;
  conditions: Pool;
  hostValues: Pool;
  hostUses: HostUseConstants;
  usesOfExports: Pool;
  hostObjectFields: Pool;
  hostObjectInternalFields: Pool;
  featureIndexes: ReadonlyMap<FeatureName, number>;
}

function formatNames(context: AttachmentContext, names: readonly ModelName[]): string | null {
  return context.names.add(names.map(name => formatName(name)));
}

function formatCondition(context: AttachmentContext, condition: ModelCondition | null): string | null {
  if (condition === null) return null;
  return context.conditions.addElement(
    formatAggregate([
      ["operand", formatOperand(condition.operand)],
      ["isOneOf", formatNames(context, condition.isOneOf)],
      ["startsWith", formatNames(context, condition.startsWith)],
      ["calledOn", formatId("BuiltinID", condition.calledOn)],
      ["hasProperty", formatName(condition.hasProperty)],
      ["buildAdmitsRuntimeCode", condition.buildAdmitsRuntimeCode ? "true" : null],
      ["callRunsOtherCode", condition.callRunsOtherCode ? "true" : null],
      ["objectNobodyKnowsIsWritten", condition.objectNobodyKnowsIsWritten ? "true" : null],
    ]),
  );
}

function formatFeature(context: AttachmentContext, builtin: ModelBuiltin, feature: FeatureName): string {
  const index = context.featureIndexes.get(feature);
  if (index === undefined)
    throw new GeneratorError(`${builtin.text} uses ${feature}, which src/trim/features does not declare`);
  return `static_cast<RemovableFeature>(${index})`;
}

function formatFeatureUse(context: AttachmentContext, builtin: ModelBuiltin, use: ModelFeatureUse): string {
  return formatAggregate([
    ["builtin", formatId("BuiltinID", builtin)],
    ["overload", formatId("BuiltinOverloadID", use.overload)],
    ["feature", formatFeature(context, builtin, use.feature)],
    ["isGuard", use.isGuard ? "true" : null],
    ["condition", formatCondition(context, use.condition)],
  ]);
}

function formatUnseenCode(context: AttachmentContext, builtin: ModelBuiltin): string[] {
  const condition = formatCondition(context, builtin.attachments.unseenCodeCondition);
  if (condition === null) return [];
  return [
    formatAggregate([
      ["builtin", formatId("BuiltinID", builtin)],
      ["condition", condition],
    ]),
  ];
}

function formatHostValue(value: ModelHostValue): string | null {
  const kind = ["kind", formatEnumerator("BuiltinPlaceKind", value.place)] as const;
  switch (value.place) {
    case "None":
      return null;
    case "NativeMemory":
      return formatAggregate([kind]);
    case "NewValue":
      return formatAggregate([kind, ["newValueType", formatId("BuiltinTypeID", value.type)]]);
    case "NativeCell":
      return formatAggregate([kind, ["nativeCell", formatName(value.cell)]]);
  }
}

function formatHostValues(context: AttachmentContext, values: readonly ModelHostValue[]): string | null {
  return context.hostValues.add(values.map(value => formatHostValue(value) ?? "{ }"));
}

function formatHostCall(context: AttachmentContext, call: ModelHostCall): string {
  return formatAggregate([
    ["times", formatUnlessDefault("BuiltinCallbackTimes", call.times, "Once")],
    ["thisValue", formatHostValue(call.thisValue)],
    ["listsArguments", call.arguments === null ? null : "true"],
    ["arguments", formatHostValues(context, call.arguments ?? [])],
    ["otherArguments", formatHostValue(call.otherArguments)],
    ["result", formatHostUses(context, call.result)],
  ]);
}

function formatHostUse(context: AttachmentContext, use: ModelHostUse): string {
  const named = use.read === "PassedTo" || use.read === "IsValueOf" ? use.builtin : null;
  return formatAggregate([
    ["use", formatUnlessDefault("BuiltinHostReadUse", use.read, "Inspected")],
    ["memberPath", formatNames(context, use.path)],
    ["builtin", formatId("BuiltinID", named)],
    ["argumentIndex", use.read === "PassedTo" ? formatUnlessZero(use.argument) : null],
    ["nativeCell", use.read === "Kept" ? formatName(use.cell) : null],
    [
      "call",
      use.read === "Called" && use.call !== null ? context.hostUses.addCall(formatHostCall(context, use.call)) : null,
    ],
  ]);
}

function formatHostUses(context: AttachmentContext, uses: ModelHostUses): string | null {
  if (uses === null) return null;
  return formatAggregate([
    ["areListed", "true"],
    ["list", context.hostUses.addList(uses.map(use => formatHostUse(context, use)))],
  ]);
}

function formatModuleLoad(context: AttachmentContext, builtin: ModelBuiltin | null, load: ModelModuleLoad): string {
  const exports = load.exports ?? [];
  return formatAggregate([
    ["builtin", formatId("BuiltinID", builtin)],
    ["module", formatId("RuntimeModuleID", load.module)],
    ["readsEveryExport", load.exports === null ? "true" : "false"],
    [
      "exports",
      formatNames(
        context,
        exports.map(read => read.name),
      ),
    ],
    ["usesOfExports", context.usesOfExports.add(exports.map(read => formatHostUses(context, read.uses) ?? "{ }"))],
    ["condition", formatCondition(context, load.condition)],
  ]);
}

function formatCalledFunction(
  context: AttachmentContext,
  builtin: ModelBuiltin | null,
  called: ModelCalledFunction,
): string {
  return formatAggregate([
    ["builtin", formatId("BuiltinID", builtin)],
    ["function", formatId("RuntimeFunctionID", called.function)],
    ["condition", formatCondition(context, called.condition)],
    ["uses", formatHostUses(context, called.uses)],
  ]);
}

function formatHostObject(context: AttachmentContext, object: ModelHostObject): string {
  const { cell, fields, internalFields } = object;
  return formatAggregate([
    ["nativeCell", formatName(cell)],
    ["function", formatId("BuiltinID", object.function)],
    ["prototype", formatId("BuiltinID", object.prototype)],
    [
      "fields",
      context.hostObjectFields.add(
        fields.map(({ name, value }) =>
          formatAggregate([
            ["name", name === null ? null : formatName(name)],
            ["value", formatHostValue(value)],
          ]),
        ),
      ),
    ],
    [
      "internalFields",
      context.hostObjectInternalFields.add(
        internalFields.map(({ index, uses }) =>
          formatAggregate([
            ["index", formatUnlessZero(index)],
            ["uses", formatHostUses(context, uses)],
          ]),
        ),
      ),
    ],
    ["keepsStringsOfStoredValues", object.keepsStringsOfStoredValues ? "true" : null],
  ]);
}

function formatHostMethodCall(context: AttachmentContext, { name, cell, call }: ModelHostMethodCall): string {
  return formatAggregate([
    ["name", formatName(name)],
    ["nativeCell", formatName(cell)],
    ["call", context.hostUses.addCall(formatHostCall(context, call))],
  ]);
}

function formatNamedMemberCall(context: AttachmentContext, call: ModelNamedMemberCall): string {
  return formatAggregate([
    ["name", formatName(call.name)],
    ["arguments", formatHostValues(context, call.arguments)],
  ]);
}

function formatForms(builtin: ModelBuiltin): string[] {
  const { appendForm, hostAppendSymbol, jsonTextForm, literalPartsForm, bodyBytesForm } = builtin.attachments;
  if ([appendForm, hostAppendSymbol, jsonTextForm, literalPartsForm, bodyBytesForm].every(form => form === null))
    return [];
  return [
    formatAggregate([
      ["builtin", formatId("BuiltinID", builtin)],
      ["appendForm", appendForm === null ? null : formatEnumerator("InlineBuiltin", appendForm)],
      ["hasHostAppendFunction", hostAppendSymbol === null ? null : "true"],
      ["jsonTextForm", formatId("BuiltinID", jsonTextForm === null ? null : jsonTextForm.builtin)],
      ["jsonTextArgument", formatOperand(jsonTextForm === null ? null : jsonTextForm.argument)],
      ["literalPartsForm", formatId("BuiltinID", literalPartsForm === null ? null : literalPartsForm.builtin)],
      ["literalPartsArgument", formatOperand(literalPartsForm === null ? null : literalPartsForm.argument)],
      [
        "literalPartNames",
        literalPartsForm === null ? null : `{ ${literalPartsForm.names.map(name => formatName(name)).join(", ")} }`,
      ],
      ["bodyBytesForm", formatId("BuiltinID", bodyBytesForm)],
    ]),
  ];
}

function formatBoxedCall(builtin: ModelBuiltin): string[] {
  const { boxedCallStub } = builtin.attachments;
  if (boxedCallStub === null) return [];
  return [
    formatAggregate([
      ["builtin", formatId("BuiltinID", builtin)],
      ["stub", formatEnumerator("BuiltinBoxedStub", boxedCallStub)],
    ]),
  ];
}

function formatNumberConstant(builtin: ModelBuiltin): string[] {
  const { constant } = builtin;
  if (constant === null || constant.constant !== "Number") return [];
  return [
    formatAggregate([
      ["builtin", formatId("BuiltinID", builtin)],
      ["value", formatDouble(constant.value)],
    ]),
  ];
}

function formatStringConstants(builtin: ModelBuiltin): string[] {
  const { constant } = builtin;
  if (constant === null || constant.constant !== "String") return [];
  return constant.texts.map(({ platforms, architectures, text }) =>
    formatAggregate([
      ["builtin", formatId("BuiltinID", builtin)],
      [
        "platforms",
        formatOptionSet(
          "BuiltinPlatform",
          targetPlatforms.filter(platform => platforms.includes(platform)),
        ),
      ],
      [
        "architectures",
        formatOptionSet(
          "BuiltinArchitecture",
          targetArchitectures.filter(architecture => architectures.includes(architecture)),
        ),
      ],
      ["text", formatName(text)],
    ]),
  );
}

// The implementation that ends in a call of the entry's function object, which has the callee and the function of the library.
function calledImplementationOf(implementation: ModelImplementation): ModelImplementation | null {
  return implementation.how === "Inline" ? implementation.otherwise : implementation;
}

function formatOwnSlot({ structure, offset }: Extract<ModelImplementation, { how: "OwnSlot" }>): string {
  return formatAggregate([
    ["structure", formatId("RealmStructureID", structure)],
    ["offset", String(offset)],
  ]);
}

function formatOverloadSummary({ builtin, mode, code: { implementation } }: ModelOverload): string {
  const called = calledImplementationOf(implementation);
  const callee = called !== null && "callee" in called ? called.callee : "None";
  const libraryFunction = called !== null && "function" in called ? called.function : null;
  return formatAggregate([
    ["builtin", formatId("BuiltinID", builtin)],
    ["mode", formatUnlessDefault("BuiltinCallMode", mode, "Call")],
    ["kind", formatUnlessDefault("BuiltinImplementationKind", implementation.how, "Generic")],
    ["hasOtherwise", implementation.how === "Inline" && implementation.otherwise !== null ? "true" : null],
    ["callee", formatUnlessDefault("BuiltinCallee", callee, "None")],
    ["function", formatId("RuntimeFunctionID", libraryFunction)],
    ["ownSlot", implementation.how === "OwnSlot" ? formatOwnSlot(implementation) : null],
  ]);
}

function emitTableArray(cppType: string, plural: string, elements: readonly string[]): string {
  return emitArray(`constinit const ${cppType} builtinTable${plural}`, elements);
}

export function emitCppAttachments(model: TableModel, features: readonly TableFeature[]): string {
  const context: AttachmentContext = {
    names: new Pool("BuiltinName", "names"),
    conditions: new Pool("BuiltinCondition", "conditions"),
    hostValues: new Pool("BuiltinPlace", "hostValues"),
    hostUses: new HostUseConstants(),
    usesOfExports: new Pool("BuiltinHostUses", "usesOfExports"),
    hostObjectFields: new Pool("BuiltinHostObjectField", "hostObjectFields"),
    hostObjectInternalFields: new Pool("BuiltinHostObjectInternalField", "hostObjectInternalFields"),
    featureIndexes: new Map(features.map(feature => [feature.name, feature.index])),
  };
  const { builtins } = model;
  const arrays = [
    emitTableArray(
      "BuiltinFeatureUse",
      "FeatureUses",
      builtins.flatMap(builtin => builtin.attachments.featureUses.map(use => formatFeatureUse(context, builtin, use))),
    ),
    emitTableArray(
      "BuiltinUnseenCode",
      "UnseenCode",
      builtins.flatMap(builtin => formatUnseenCode(context, builtin)),
    ),
    emitTableArray(
      "BuiltinModuleLoad",
      "ModuleLoads",
      builtins.flatMap(builtin =>
        builtin.attachments.moduleLoads.map(load => formatModuleLoad(context, builtin, load)),
      ),
    ),
    emitTableArray(
      "BuiltinModuleLoad",
      "StartupLoads",
      model.startup.loads.map(load => formatModuleLoad(context, null, load)),
    ),
    emitTableArray(
      "BuiltinCalledFunction",
      "CalledFunctions",
      builtins.flatMap(builtin =>
        builtin.attachments.calledFunctions.map(called => formatCalledFunction(context, builtin, called)),
      ),
    ),
    emitTableArray(
      "BuiltinCalledFunction",
      "StartupCalledFunctions",
      model.startup.functionsCalledWithLoads.map(called => formatCalledFunction(context, null, called)),
    ),
    emitTableArray(
      "BuiltinHostObject",
      "HostObjects",
      model.hostObjects.map(object => formatHostObject(context, object)),
    ),
    emitTableArray(
      "BuiltinNamedMemberCall",
      "NamedMemberCalls",
      model.namedMemberCalls.map(call => formatNamedMemberCall(context, call)),
    ),
    emitTableArray(
      "BuiltinHostMethodCall",
      "HostMethodCalls",
      model.hostMethodCalls.map(call => formatHostMethodCall(context, call)),
    ),
    emitTableArray("BuiltinForms", "Forms", builtins.flatMap(formatForms)),
    emitTableArray("BuiltinBoxedCall", "BoxedCalls", builtins.flatMap(formatBoxedCall)),
    emitTableArray("BuiltinNumberConstant", "NumberConstants", builtins.flatMap(formatNumberConstant)),
    emitTableArray("BuiltinStringConstant", "StringConstants", builtins.flatMap(formatStringConstants)),
    emitTableArray("BuiltinOverloadSummary", "OverloadSummaries", model.overloads.map(formatOverloadSummary)),
  ];
  return wrapFile(
    ["AOTBuiltinTable.h", "AOTBuiltinTableArrays.h"],
    joinBlocks([
      context.names.emit(),
      context.conditions.emit(),
      context.hostValues.emit(),
      context.hostUses.emit(),
      context.usesOfExports.emit(),
      context.hostObjectFields.emit(),
      context.hostObjectInternalFields.emit(),
      ...arrays,
    ]),
  );
}
