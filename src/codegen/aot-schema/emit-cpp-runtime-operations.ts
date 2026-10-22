import { argumentBufferPointees, pointeeOf, runtimeValueKinds } from "./check-runtime.ts";
import { blocks, braced, constexprSwitch, cppHeader, cppSource, macroLines } from "./lines.ts";
import type { RuntimeOperation, Schema } from "./model.ts";
import { mayThrow } from "./model.ts";
import { cppRuntimeFunctionName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

const operationsMacro = "FOR_EACH_AOT_RUNTIME_OPERATION";
const pointerKind = "Pointer";

const bufferAccesses = ["ReadsAndWrites", "Reads", "None"] as const;
type BufferAccess = (typeof bufferAccesses)[number];

const stringDeclarations = `namespace WTF {
class UniquedStringImpl;
}
using WTF::UniquedStringImpl;`.split("\n");

const instanceDeclarations = `struct Instance;
struct Slot;
using SiteCache = RememberedSlot<Slot>*;
using Typed::RuntimeOperation;`.split("\n");

const signatureDeclarations = `struct RuntimeSignature {
    RuntimeValueKind result { RuntimeValueKind::Void };
    std::span<const RuntimeValueKind> parameters;
    bool takesInstance { true };
    bool mayThrow { true };
};

JS_EXPORT_PRIVATE RuntimeSignature signatureOf(RuntimeOperation);
JS_EXPORT_PRIVATE void* addressOf(RuntimeOperation);`.split("\n");

function runtimeDecl(operation: RuntimeOperation): string {
  const name = cppRuntimeFunctionName(operation.name);
  const parameters = [
    ...(operation.isLeaf ? [] : ["Instance*"]),
    ...operation.parameters.map(parameter =>
      parameter.name === null ? parameter.type : `${parameter.type} ${parameter.name}`,
    ),
  ].join(", ");
  if (operation.preservesMost) {
    return `extern "C" ${operation.resultType} AOT_PRESERVE_MOST_LEAF_ATTRIBUTES ${name}(${parameters}) JIT_OPERATION_REFERENCED_FROM_ASM WTF_INTERNAL;`;
  }
  const macro = mayThrow(operation.effects) ? "JSC_DECLARE_JIT_OPERATION" : "JSC_DECLARE_NOEXCEPT_JIT_OPERATION";
  return `${macro}(${name}, ${operation.resultType}, (${parameters}));`;
}

function pointsIntoArgumentBuffer(type: string): boolean {
  const pointee = pointeeOf(type);
  return pointee !== null && argumentBufferPointees.get(pointee) === true;
}

function bufferAccess(operation: RuntimeOperation): BufferAccess {
  const buffers = operation.parameters.map(parameter => parameter.type).filter(pointsIntoArgumentBuffer);
  if (buffers.length === 0) return "None";
  return buffers.every(type => type.startsWith("const ")) ? "Reads" : "ReadsAndWrites";
}

function lookup(
  operations: readonly RuntimeOperation[],
  signature: string,
  valueOf: (operation: RuntimeOperation) => string,
  defaultValue: string | null,
  qualifier: "constexpr" | "" = "constexpr",
): string[] {
  return constexprSwitch({
    signature,
    subject: "operation",
    enumName: "RuntimeOperation",
    cases: operations.map(operation => ({ label: operation.name, value: valueOf(operation) })),
    defaultValue,
    qualifier,
  });
}

function runtimeHeader(schema: Schema): string[] {
  const operations = schema.runtimeOperations;
  const valueKinds = [...new Set([...runtimeValueKinds.values(), pointerKind])];
  const includes = [
    '"AOTSchemaEnums.h"',
    '"AOTStubLeafConvention.h"',
    '"JITOperationValidation.h"',
    '"OperationResult.h"',
    '"UGPRPair.h"',
    "<span>",
    "<wtf/text/Latin1Character.h>",
  ];
  const body = blocks(
    stringDeclarations,
    macroLines(
      operationsMacro,
      operations.map(operation => operation.name),
    ),
    ["namespace JSC {"],
    ["class JSCell;", "template<typename> class RememberedSlot;"],
    ["namespace AOT {"],
    instanceDeclarations,
    operations.map(runtimeDecl),
    [
      `enum class RuntimeValueKind : uint8_t { ${valueKinds.join(", ")} };`,
      `enum class ArgumentBufferAccess : uint8_t { ${bufferAccesses.join(", ")} };`,
    ],
    signatureDeclarations,
    lookup(operations, "bool isLeaf(RuntimeOperation operation)", operation => String(operation.isLeaf), "false"),
    lookup(
      operations,
      "bool preservesMostRegisters(RuntimeOperation operation)",
      operation => String(operation.preservesMost),
      "false",
    ),
    lookup(
      operations,
      "ArgumentBufferAccess argumentBufferAccessOf(RuntimeOperation operation)",
      operation => `ArgumentBufferAccess::${bufferAccess(operation)}`,
      "ArgumentBufferAccess::None",
    ),
    ["} } // namespace JSC::AOT"],
  );
  return cppHeader(includes, body);
}

function valueKind(type: string): string {
  return `RuntimeValueKind::${runtimeValueKinds.get(type) ?? pointerKind}`;
}

function parameterKinds(operation: RuntimeOperation): string[] {
  return operation.parameters.map(parameter => valueKind(parameter.type));
}

function runtimeSource(schema: Schema): string[] {
  const operations = schema.runtimeOperations;
  const listKey = (operation: RuntimeOperation) => parameterKinds(operation).join(", ");
  const users = Map.groupBy(
    operations.filter(operation => operation.parameters.length > 0),
    listKey,
  );
  const arrayNames = new Map([...users.keys()].map((key, index) => [key, `parameterKinds${index}`]));
  const arrays = [...users].flatMap(([key, [first]]) =>
    braced(`static constexpr RuntimeValueKind ${arrayNames.get(key)}[] =`, parameterKinds(first)),
  );
  const signatureOf = lookup(
    operations,
    "RuntimeSignature signatureOf(RuntimeOperation operation)",
    operation => {
      const parameters = arrayNames.get(listKey(operation)) ?? "{ }";
      return `{ ${valueKind(operation.resultType)}, ${parameters}, ${!operation.isLeaf}, ${mayThrow(operation.effects)} }`;
    },
    null,
    "",
  );
  const addressOf = [
    "void* addressOf(RuntimeOperation operation)",
    "{",
    "    switch (operation) {",
    "#define AOT_ADDRESS_CASE(name) \\",
    "    case RuntimeOperation::name: \\",
    `        return reinterpret_cast<void*>(${cppRuntimeFunctionName("##name")});`,
    `    ${operationsMacro}(AOT_ADDRESS_CASE)`,
    "#undef AOT_ADDRESS_CASE",
    "    }",
    "    RELEASE_ASSERT_NOT_REACHED();",
    "}",
  ];
  const body = blocks(
    ["namespace JSC { namespace AOT {"],
    arrays,
    signatureOf,
    addressOf,
    ["} } // namespace JSC::AOT"],
  );
  return cppSource(['"AOTSchemaRuntimeOperations.h"'], body);
}

export function emitCppRuntimeOperations(context: EmitContext): OutputFile[] {
  return [
    { name: "AOTSchemaRuntimeOperations.h", lines: runtimeHeader(context.schema) },
    { name: "AOTSchemaRuntimeOperations.cpp", lines: runtimeSource(context.schema) },
  ];
}
