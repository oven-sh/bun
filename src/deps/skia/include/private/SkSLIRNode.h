/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_IRNODE
#define SKSL_IRNODE

#include "include/private/SkSLString.h"
#include "include/private/SkTArray.h"
#include "src/sksl/SkSLLexer.h"
#include "src/sksl/SkSLModifiersPool.h"
#include "src/sksl/SkSLPool.h"

#include <algorithm>
#include <atomic>
#include <unordered_set>
#include <vector>

namespace SkSL {

class Expression;
class FunctionDeclaration;
class FunctionDefinition;
class Statement;
class Symbol;
class SymbolTable;
class Type;
class Variable;
class VariableReference;
enum class VariableRefKind : int8_t;
enum class VariableStorage : int8_t;

/**
 * Represents a node in the intermediate representation (IR) tree. The IR is a fully-resolved
 * version of the program (all types determined, everything validated), ready for code generation.
 */
class IRNode : public Poolable {
public:
    virtual ~IRNode() {}

    virtual String description() const = 0;

    // No copy construction or assignment
    IRNode(const IRNode&) = delete;
    IRNode& operator=(const IRNode&) = delete;

    // line of this element within the program being compiled, for error reporting purposes
    int fLine;

protected:
    IRNode(int line, int kind)
        : fLine(line)
        , fKind(kind) {}

    int fKind;
};

}  // namespace SkSL

#endif
