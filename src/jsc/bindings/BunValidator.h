#pragma once

#include "root.h"
#include <JavaScriptCore/AOTValidatorBytecode.h>
#include <optional>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

// `Bun.Validator`: a JSON Schema becomes validation nodes, and the engine generates bytecode from the nodes.
namespace Bun {

struct ValidatorNodes {
    Ref<JSC::ValidationPlan> plan;
    // Both are indexed like plan->nodes. A null string means the schema gives none.
    // "title": how error messages name the type.
    Vector<String> titles;
    // "x-bun".message: replaces the message of an issue at this node.
    Vector<String> messages;
};

// JSONSchemaValidator.cpp and JSONSchemaNodes.cpp.
// Takes any value. Throws a TypeError unless `schema` is a JSON Schema that Bun.Validator supports.
std::optional<ValidatorNodes> readJSONSchema(JSC::JSGlobalObject*, JSC::JSValue schema, JSC::JSValue options);

// ValidatorInput.cpp.
// Copies every object and array that the plan describes into plain objects and arrays that nobody else holds.
// This is the only step that runs getters and proxy traps, and it reads each property once.
// Returns an empty value after throwing.
JSC::JSValue copyForValidation(JSC::JSGlobalObject*, const JSC::ValidationPlan&, JSC::JSValue);

// ValidationPlanText.cpp.
// The nodes in the JSON format that src/aot/prelude/validation.ts reads.
String writeValidationPlanText(const ValidatorNodes&);

// ValidationReport.cpp.
// For a plain-data value that the bytecode has refused. JavaScript only words the error: these never accept.
// Always leaves a TypeError with `issues` (or another exception) pending.
void throwValidationError(JSC::JSGlobalObject*, const String& planText, JSC::JSValue refusedValue);
// The `issues` of that error: an array with at least one issue. Returns an empty value after throwing.
JSC::JSValue collectValidationIssues(JSC::JSGlobalObject*, const String& planText, JSC::JSValue refusedValue);

// BunValidator.cpp.
JSC::JSValue constructValidatorConstructor(JSC::VM&, JSC::JSObject* bunObject);

} // namespace Bun
