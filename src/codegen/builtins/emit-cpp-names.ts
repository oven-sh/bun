import { GeneratorError } from "./declarations.ts";
import {
  emitArray,
  formatAggregate,
  formatCharacters,
  formatEnumerator,
  formatId,
  formatName,
  joinBlocks,
  lengthOfCharacters,
  Pool,
  wrapFile,
} from "./emit-cpp-support.ts";
import type {
  ModelBuiltin,
  ModelClass,
  ModelName,
  ModelProtocolKeys,
  ModelSlot,
  NameKind,
  TableModel,
} from "./model.ts";
import { compareBytes, tokenOf } from "./paths.ts";
import { cap } from "./support.ts";

export const textNamesArray = "builtinTableTextNames";
export const textNameSlotsArray = "builtinTableTextNameSlots";
// Code of the engine names this one, so its type has a name that does not say how long it is.
export const classTokensArray = "builtinTableClassTokens";
export const classTokensType = "BuiltinClassTokenStorage";

interface TableArray {
  cppType: string;
  name: string;
  elements: readonly string[];
  // Of a list of texts: one behind the other, each with a zero behind it.
  numberOfCharacters?: number;
}

interface NameArrays {
  pools: readonly Pool[];
  arrays: readonly TableArray[];
}

interface MemberNameClasses {
  name: ModelName;
  classes: ModelClass[];
}

// FNV-1a over the tokens, each with a zero behind it. The engine makes the token of an entry from its text, and a test of the engine hashes what it makes.
export function hashOfBuiltinTokens(model: TableModel): number {
  let hash = 0x811c9dc5;
  for (const { token } of model.builtins) {
    for (const byte of Buffer.from(`${token}\0`, "latin1")) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}

export function slotTokenOf(slot: ModelSlot): string {
  return `${slot.owner.token}${cap(slot.name.text)}`;
}

export interface NamedList<Item> {
  namespace: string;
  cppType: string;
  array: string;
  countName: string;
  // In the order of the positions: what the engine declares, then the roles of the host, each by the bytes of its constant.
  items: readonly (readonly [constant: string, item: Item])[];
  format: (item: Item) => string;
}

function orderNamedItems<Item>(
  items: readonly (readonly [constant: string, item: Item])[],
  isOfEngine: (item: Item) => boolean,
): readonly (readonly [constant: string, item: Item])[] {
  return items.toSorted(
    ([left, leftItem], [right, rightItem]) =>
      Number(!isOfEngine(leftItem)) - Number(!isOfEngine(rightItem)) || compareBytes(left, right),
  );
}

// What hand-written C++ names is a position in one of these lists. The declarations of the engine alone say what is in them, so no entry of the host moves or adds a position.
export function namedListsOf(model: TableModel): readonly NamedList<any>[] {
  const isEngineRow = ({ origin }: { origin: string }): boolean => origin === "Engine";
  const builtins: NamedList<ModelBuiltin> = {
    namespace: "Builtins",
    cppType: "BuiltinID",
    array: "builtinTableNamedBuiltins",
    countName: "numberOfNamedBuiltins",
    items: orderNamedItems(
      [
        ...model.builtins.filter(isEngineRow).map(builtin => [builtin.token, builtin] as const),
        ...model.hostRoles.map(({ token, builtin }) => [token, builtin] as const),
      ],
      isEngineRow,
    ),
    format: builtin => formatId("BuiltinID", builtin),
  };
  const names: NamedList<ModelName> = {
    namespace: "BuiltinNames",
    cppType: "BuiltinName",
    array: "builtinTableNamedNames",
    countName: "numberOfNamedBuiltinNames",
    items: orderNamedItems(
      model.names.flatMap(name =>
        name.cppConstant === null || !model.namesOfEngine.has(name) ? [] : [[name.cppConstant, name] as const],
      ),
      () => true,
    ),
    format: name => formatName(name),
  };
  const classes: NamedList<ModelClass> = {
    namespace: "BuiltinClasses",
    cppType: "BuiltinClassID",
    array: "builtinTableNamedClasses",
    countName: "numberOfNamedBuiltinClasses",
    items: orderNamedItems(
      [
        ...model.classes.filter(isEngineRow).map(builtinClass => [builtinClass.token, builtinClass] as const),
        ...model.hostClassRoles.map(({ token, builtinClass }) => [token, builtinClass] as const),
      ],
      isEngineRow,
    ),
    format: builtinClass => formatId("BuiltinClassID", builtinClass),
  };
  const layouts: NamedList<TableModel["layouts"][number]> = {
    namespace: "BuiltinLayouts",
    cppType: "BuiltinLayoutID",
    array: "builtinTableNamedLayouts",
    countName: "numberOfNamedBuiltinLayouts",
    items: orderNamedItems(
      model.layouts.filter(isEngineRow).map(layout => [layout.token, layout] as const),
      () => true,
    ),
    format: layout => formatId("BuiltinLayoutID", layout),
  };
  return [builtins, names, classes, layouts];
}

export function namedBuiltinsOf(model: TableModel): readonly ModelBuiltin[] {
  return namedListsOf(model)[0].items.map(([, builtin]) => builtin);
}

function getText(name: ModelName): string {
  return name.text;
}

function getToken(item: { token: string }): string {
  return item.token;
}

function checkNameNumbers(namesInArrayOrder: readonly ModelName[]): void {
  namesInArrayOrder.forEach(({ kind, text, number }, index) => {
    if (number !== index)
      throw new GeneratorError(`${kind} name ${JSON.stringify(text)} is numbered ${number}, not ${index}`);
  });
}

function collectMemberClasses(classes: readonly ModelClass[]): MemberNameClasses[] {
  const classesByName = new Map<number, MemberNameClasses>();
  for (const builtinClass of classes) {
    for (const { name } of builtinClass.prototype?.members ?? []) {
      const found = classesByName.get(name.number);
      if (found === undefined) classesByName.set(name.number, { name, classes: [builtinClass] });
      else found.classes.push(builtinClass);
    }
  }
  return [...classesByName.values()].sort((a, b) => a.name.number - b.name.number);
}

function formatSymbolConstant(builtin: ModelBuiltin): string[] {
  const { constant } = builtin;
  if (constant === null || constant.constant !== "Symbol") return [];
  return [
    formatAggregate([
      ["symbol", formatId("BuiltinID", builtin)],
      ["name", formatName(constant.name)],
      ["wellKnownSymbol", formatEnumerator("WellKnownSymbol", cap(constant.name.text))],
    ]),
  ];
}

function formatMemberClasses({ name, classes }: MemberNameClasses, memberClasses: Pool): string {
  return formatAggregate([
    ["name", formatName(name)],
    ["classes", memberClasses.addStretch(classes.map(builtinClass => formatId("BuiltinClassID", builtinClass)))],
  ]);
}

function formatProtocolKeys({ protocol, keys }: ModelProtocolKeys, protocolKeyNames: Pool): string {
  return formatAggregate([
    ["protocol", formatEnumerator("Protocol", protocol)],
    ["keys", protocolKeyNames.add(keys.map(key => formatName(key)))],
  ]);
}

function createTexts(name: string, texts: readonly string[]): TableArray {
  const numberOfCharacters = texts.reduce((count, text) => count + text.length + 1, 0);
  return {
    cppType: `BuiltinTextStorage<${texts.length}, ${numberOfCharacters}>`,
    name,
    elements: texts.map(text => formatCharacters(text)),
    numberOfCharacters,
  };
}

export function nameArraysOf(model: TableModel): NameArrays {
  const namesOfKind = (kind: NameKind) => model.names.filter(name => name.kind === kind);
  const textNames = namesOfKind("Text");
  const symbolNames = namesOfKind("WellKnownSymbol");
  const registeredSymbolNames = namesOfKind("RegisteredSymbol");
  checkNameNumbers([...textNames, ...symbolNames, ...registeredSymbolNames]);
  const memberClasses = new Pool("BuiltinClassID", "builtinTableMemberClasses", true);
  const protocolKeyNames = new Pool("BuiltinName", "protocolKeyNames");
  return {
    pools: [memberClasses, protocolKeyNames],
    arrays: [
      createTexts(textNamesArray, textNames.map(getText)),
      createTexts("builtinTableSymbolNames", symbolNames.map(getText)),
      createTexts("builtinTableRegisteredSymbolNames", registeredSymbolNames.map(getText)),
      {
        cppType: "BuiltinSymbolConstant",
        name: "builtinTableSymbolConstants",
        elements: model.builtins.flatMap(formatSymbolConstant),
      },
      {
        cppType: "BuiltinNameClasses",
        name: "builtinTableClassesByMemberName",
        elements: collectMemberClasses(model.classes).map(entry => formatMemberClasses(entry, memberClasses)),
      },
      {
        cppType: "BuiltinProtocolKeys",
        name: "builtinTableProtocolKeys",
        elements: model.protocolKeys.map(entry => formatProtocolKeys(entry, protocolKeyNames)),
      },
      {
        cppType: "BuiltinID",
        name: "builtinTableBuiltinsWithQualifiedTokens",
        elements: model.builtins
          .filter(({ token, path }) => token !== tokenOf(path))
          .map(builtin => formatId("BuiltinID", builtin)),
      },
      createTexts(classTokensArray, model.classes.map(getToken)),
      createTexts("builtinTableSlotTokens", model.slots.map(slotTokenOf)),
      createTexts("builtinTableLayoutTokens", model.layouts.map(getToken)),
      createTexts("builtinTableModuleTokens", model.modules.map(getToken)),
    ],
  };
}

// The zero behind the last text is the one that ends the literal.
function emitTexts(declaration: string, texts: readonly string[], isDerived = false): string {
  const starts: number[] = [0];
  for (const text of texts) starts.push(starts[starts.length - 1] + lengthOfCharacters(text) + 1);
  const rowsOfStarts: string[] = [];
  for (let first = 0; first < starts.length; first += 16)
    rowsOfStarts.push(`        ${starts.slice(first, first + 16).join(", ")},`);
  const literals = texts.map((text, index) => `    "${text}${index + 1 < texts.length ? "\\0" : ""}"`);
  return `${declaration} = ${isDerived ? "{ " : ""}{\n    ${texts.length},\n    {\n${rowsOfStarts.join("\n")}\n    },\n${literals.join("\n")}\n}${isDerived ? " }" : ""};`;
}

// The C++ compiler hashes the text names, so they have to be a constant expression.
function emitNameArray({ cppType, name, elements, numberOfCharacters }: TableArray): string {
  if (numberOfCharacters === undefined) return emitArray(`constinit const ${cppType} ${name}`, elements);
  if (elements.length === 0) return "";
  if (name === classTokensArray) return emitTexts(`constinit const ${classTokensType} ${name}`, elements, true);
  if (name !== textNamesArray) return emitTexts(`constinit const ${cppType} ${name}`, elements);
  return joinBlocks([
    emitTexts(`constexpr ${cppType} ${name}`, elements),
    `constinit const BuiltinNameSlots<${elements.length}> ${textNameSlotsArray} = makeBuiltinNameSlots<${name}>();`,
  ]);
}

export function emitCppNames(model: TableModel): string {
  const { pools, arrays } = nameArraysOf(model);
  const namedLists = namedListsOf(model).map(({ cppType, array, items, format }) =>
    emitArray(
      `constinit const ${cppType} ${array}`,
      items.map(([, item]) => format(item)),
    ),
  );
  const body = joinBlocks([
    ...pools.map(pool => pool.emit()),
    ...arrays.map(emitNameArray),
    "inline namespace AOT_NAMESPACE_OF_ENGINE_LIST {",
    ...namedLists,
    "}",
  ]);
  return wrapFile(["AOTBuiltinNameSlots.h", "AOTBuiltinTable.h", "AOTBuiltinTableArrays.h"], body);
}
