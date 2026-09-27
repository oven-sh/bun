#pragma once

namespace Bun {
using namespace JSC;

// `className` is "MySQLError" or "PostgresError" (src/js/internal/sql/errors.ts).
Structure* createSQLErrorStructure(VM& vm, JSGlobalObject* globalObject, ASCIILiteral className);
}
