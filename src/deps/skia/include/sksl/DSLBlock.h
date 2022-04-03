/*
 * Copyright 2021 Google LLC.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_DSL_BLOCK
#define SKSL_DSL_BLOCK

#include "include/private/SkSLDefines.h"
#include "include/sksl/DSLExpression.h"
#include "include/sksl/DSLStatement.h"

#include <memory>

namespace SkSL {

class Block;
class SymbolTable;

namespace dsl {

class DSLBlock {
public:
    template<class... Statements>
    DSLBlock(Statements... statements) {
        fStatements.reserve_back(sizeof...(statements));
        // in C++17, we could just do:
        // (fStatements.push_back(DSLStatement(statements.release()).release()), ...);
        int unused[] =
            {0,
            (static_cast<void>(fStatements.push_back(DSLStatement(statements.release()).release())),
             0)...};
        static_cast<void>(unused);
    }

    DSLBlock(DSLBlock&& other) = default;

    DSLBlock(SkSL::StatementArray statements, std::shared_ptr<SymbolTable> symbols = nullptr);

    DSLBlock(SkTArray<DSLStatement> statements, std::shared_ptr<SymbolTable> symbols = nullptr);

    ~DSLBlock();

    DSLBlock& operator=(DSLBlock&& other) {
        fStatements = std::move(other.fStatements);
        return *this;
    }

    void append(DSLStatement stmt);

    std::unique_ptr<SkSL::Block> release();

private:
    SkSL::StatementArray fStatements;
    std::shared_ptr<SkSL::SymbolTable> fSymbols;

    friend class DSLStatement;
    friend class DSLFunction;
};

} // namespace dsl

} // namespace SkSL

#endif
