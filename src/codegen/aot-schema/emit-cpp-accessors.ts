import { engineTypeOf, listFirstWord, twoWordScalars } from "./cpp-types.ts";
import { blocks, braced, cppHeader, cppMarker, indent, indentation, lineWidth, pack } from "./lines.ts";
import type { Entry, Kind, PayloadField, Schema } from "./model.ts";
import { entriesOf } from "./model.ts";
import { cppOperandGetterName, cppSetterName, upperFirst } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

interface User {
  readonly name: string;
  readonly entry: Entry;
  readonly position: string;
}

interface PayloadUser extends User {
  readonly field: PayloadField;
}

type UsersByName<Part extends User = User> = ReadonlyMap<string, readonly Part[]>;

interface NamedParts {
  readonly payload: UsersByName<PayloadUser>;
  readonly flags: UsersByName;
  readonly operands: UsersByName;
  readonly variadicOperands: UsersByName;
}

interface EntryEnum {
  readonly isTerminator: boolean;
  readonly enumName: string;
  readonly tag: string;
  readonly entrySetPrefix: string;
}

type AccessorPart = "all" | "payload" | "operands";

const opcodes: EntryEnum = {
  isTerminator: false,
  enumName: "Opcode",
  tag: "opcode",
  entrySetPrefix: "OpcodeSet opcodesWith",
};

const terminatorKinds: EntryEnum = {
  isTerminator: true,
  enumName: "TerminatorKind",
  tag: "kind",
  entrySetPrefix: "TerminatorKindSet kindsWith",
};

function collect(schema: Schema): NamedParts {
  const entries = entriesOf(schema);
  const byName = <Part extends User>(partsOf: (entry: Entry) => readonly Part[]): UsersByName<Part> =>
    Map.groupBy(
      entries.flatMap(entry => partsOf(entry)),
      part => part.name,
    );
  return {
    payload: byName(entry =>
      entry.payload.map(field => {
        const position = field.firstWord === null ? listFirstWord(entry) : String(field.firstWord);
        return { name: field.name, entry, field, position };
      }),
    ),
    flags: byName(entry => entry.flags.map(flag => ({ name: flag.name, entry, position: `1 << ${flag.bit}` }))),
    operands: byName(entry =>
      entry.namedOperands.map(operand => ({ name: operand.name, entry, position: String(operand.index) })),
    ),
    variadicOperands: byName(entry => {
      const operand = entry.variadicOperand;
      return operand === null ? [] : [{ name: operand.name, entry, position: String(operand.index) }];
    }),
  };
}

function lookup(name: string, users: readonly User[]): string[] {
  const functions: string[][] = [];
  for (const { isTerminator, enumName, tag } of [opcodes, terminatorKinds]) {
    const own = users.filter(user => user.entry.isTerminator === isTerminator);
    const signature = `constexpr std::optional<unsigned> ${name}(${enumName} ${tag})`;
    if (own.length === 0) continue;
    if (own.length === 1) {
      const [{ entry, position }] = own;
      functions.push([
        `${signature} { return ${tag} == ${enumName}::${entry.name} ? std::optional<unsigned>(${position}) : std::nullopt; }`,
      ]);
      continue;
    }
    const lines = [signature, "{", `${indentation}switch (${tag}) {`];
    for (const [position, group] of Map.groupBy(own, user => user.position)) {
      const labels = pack(
        group.map(user => `case ${enumName}::${user.entry.name}:`),
        indentation,
      );
      const result = `return ${position};`;
      const last = labels.length - 1;
      if (labels[last].length + 1 + result.length <= lineWidth) labels[last] += ` ${result}`;
      else labels.push(`${indentation}${indentation}${result}`);
      lines.push(...labels);
    }
    lines.push(`${indentation}default: return std::nullopt;`, `${indentation}}`, "}");
    functions.push(lines);
  }
  return blocks(...functions);
}

function positionsHeader(namespace: string, table: UsersByName): string[] {
  return cppHeader(
    [],
    [
      `namespace JSC { namespace AOT { namespace Typed { namespace ${namespace} {`,
      "",
      ...blocks(...[...table].map(([name, users]) => lookup(name, users))),
      "",
      `} } } } // namespace JSC::AOT::Typed::${namespace}`,
    ],
  );
}

function listAccessorLines(name: string, element: Kind, position: string): string[] {
  const type = engineTypeOf(element);
  const setter = `void ${cppSetterName(name)}(std::span<const ${type}> ${name})`;
  const isTwoWordScalar = element.tag === "Scalar" && twoWordScalars.has(element.scalar);
  if (element.tag === "Record" || element.tag === "Variant" || isTwoWordScalar) {
    return [
      `PayloadListView<${type}> ${name}() const LIFETIME_BOUND { return PayloadListView<${type}>(payloadListFrom(${position})); }`,
      `${setter} { setPayloadListFrom(${position}, encodePayloadList(${name}).span()); }`,
    ];
  }
  return [
    `std::span<const ${type}> ${name}() const LIFETIME_BOUND { return payloadListOf<${type}>(${position}); }`,
    `${setter} { setPayloadListOf<${type}>(${position}, ${name}); }`,
  ];
}

function accessorLines(name: string, kind: Kind, isOptional: boolean, tag: string): string[] {
  const setter = cppSetterName(name);
  const position = `declaredPosition(PayloadWord::${name}(${tag}))`;
  if (kind.tag === "List") return listAccessorLines(name, kind.element, position);
  if (kind.tag === "Scalar" && twoWordScalars.has(kind.scalar)) {
    const type = engineTypeOf(kind);
    const cast = kind.scalar === "Double" ? "std::bit_cast" : "static_cast";
    return [
      `${type} ${name}() const { return ${cast}<${type}>(payloadWordPairAt(${position})); }`,
      `void ${setter}(${type} ${name}) { setPayloadWordPairAt(${position}, ${cast}<uint64_t>(${name})); }`,
    ];
  }
  const type = engineTypeOf(kind, isOptional);
  if (kind.tag === "Record" || kind.tag === "Variant") {
    return [
      `${type} ${name}() const { return decodePayloadRecord<${type}>(*this, ${position}); }`,
      `void ${setter}(const ${type}& ${name}) { encodePayloadRecord(*this, ${position}, ${name}); }`,
    ];
  }
  return [
    `${type} ${name}() const { return decodePayloadWord<${type}>(payloadWordAt(${position})); }`,
    `void ${setter}(${type} ${name}) { setPayloadWordAt(${position}, encodePayloadWord(${name})); }`,
  ];
}

function entrySet(entryEnum: EntryEnum, name: string, users: readonly User[]): string[] {
  return braced(
    `static constexpr ${entryEnum.entrySetPrefix}${upperFirst(name)}`,
    users.map(user => `${entryEnum.enumName}::${user.entry.name}`),
    "};",
    indentation,
  );
}

function accessorsInc(parts: NamedParts, entryEnum: EntryEnum, part: AccessorPart): string[] {
  const { tag } = entryEnum;
  const groups: string[][] = [];
  const ownUsersOf = (users: readonly User[]): User[] =>
    users.filter(user => user.entry.isTerminator === entryEnum.isTerminator);
  if (part !== "operands") {
    for (const [name, users] of parts.payload) {
      const own = ownUsersOf(users);
      if (own.length === 0) continue;
      const isOptional = users.some(user => user.field.isOptional);
      groups.push([
        ...indent(accessorLines(name, users[0].field.kind, isOptional, tag)),
        ...entrySet(entryEnum, name, own),
      ]);
    }
    for (const [name, users] of parts.flags) {
      const own = ownUsersOf(users);
      if (own.length === 0) continue;
      const mask = `declaredPosition(FlagMask::${name}(${tag}))`;
      const accessors = [
        `bool ${name}() const { return flags & ${mask}; }`,
        `void ${cppSetterName(name)}(bool ${name}) { flags = ${name} ? flags | ${mask} : flags & ~${mask}; }`,
      ];
      groups.push([...indent(accessors), ...entrySet(entryEnum, name, own)]);
    }
  }
  if (part !== "payload") {
    for (const [name, users] of parts.operands) {
      if (ownUsersOf(users).length === 0) continue;
      const getter = cppOperandGetterName(name, false);
      const position = `declaredPosition(OperandPosition::${name}(${tag}))`;
      groups.push(
        indent([
          `ValueID ${getter}() const { return operand(${position}); }`,
          `void ${cppSetterName(getter)}(ValueID ${name}) { setOperand(${position}, ${name}); }`,
        ]),
      );
    }
    for (const [name, users] of parts.variadicOperands) {
      if (ownUsersOf(users).length === 0) continue;
      const getter = cppOperandGetterName(name, true);
      const assertion = `RELEASE_ASSERT(VariadicOperandPosition::${name}(${tag}));`;
      groups.push(
        indent([
          `std::span<const ValueID> ${getter}() const LIFETIME_BOUND { ${assertion} return variadicOperands(); }`,
          `void ${cppSetterName(getter)}(std::span<const ValueID> ${name}) { ${assertion} setVariadicOperands(${name}); }`,
        ]),
      );
    }
  }
  return blocks(
    [cppMarker],
    part === "payload" ? [] : [`${indentation}using Instruction::setOperand;`],
    ...groups,
    part === "payload" ? ['#include "AOTSchemaValueOperandAccessors.inc"'] : [],
  );
}

export function emitCppAccessors(context: EmitContext): OutputFile[] {
  const parts = collect(context.schema);
  return [
    { name: "AOTSchemaPayloadPositions.h", lines: positionsHeader("PayloadWord", parts.payload) },
    { name: "AOTSchemaFlagMasks.h", lines: positionsHeader("FlagMask", parts.flags) },
    { name: "AOTSchemaOperandPositions.h", lines: positionsHeader("OperandPosition", parts.operands) },
    {
      name: "AOTSchemaVariadicOperandPositions.h",
      lines: positionsHeader("VariadicOperandPosition", parts.variadicOperands),
    },
    { name: "AOTSchemaValueAccessors.inc", lines: accessorsInc(parts, opcodes, "payload") },
    { name: "AOTSchemaValueOperandAccessors.inc", lines: accessorsInc(parts, opcodes, "operands") },
    { name: "AOTSchemaTerminatorAccessors.inc", lines: accessorsInc(parts, terminatorKinds, "all") },
  ];
}
