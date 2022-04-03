/*
 * Copyright 2021 Google LLC.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_DSL_FUNCTION
#define SKSL_DSL_FUNCTION

#include "include/sksl/DSLBlock.h"
#include "include/sksl/DSLExpression.h"
#include "include/sksl/DSLType.h"
#include "include/sksl/DSLVar.h"
#include "include/sksl/DSLWrapper.h"

namespace SkSL {

class Block;
class FunctionDeclaration;
class Variable;

namespace dsl {

class DSLType;

class DSLFunction {
public:
    template<class... Parameters>
    DSLFunction(const DSLType& returnType, skstd::string_view name, Parameters&... parameters)
        : DSLFunction(DSLModifiers(), returnType, name, parameters...) {}

    template<class... Parameters>
    DSLFunction(const DSLModifiers& modifiers, const DSLType& returnType, skstd::string_view name,
                Parameters&... parameters) {
        SkTArray<DSLParameter*> parameterArray;
        parameterArray.reserve_back(sizeof...(parameters));

        // in C++17, we could just do:
        // (parameterArray.push_back(&parameters), ...);
        int unused[] = {0, (static_cast<void>(parameterArray.push_back(&parameters)), 0)...};
        static_cast<void>(unused);
        // We can't have a default parameter and a template parameter pack at the same time, so
        // unfortunately we can't capture position info from this overload.
        this->init(modifiers, returnType, name, std::move(parameterArray), PositionInfo());
    }

    DSLFunction(const DSLType& returnType, skstd::string_view name,
                SkTArray<DSLParameter*> parameters, PositionInfo pos = PositionInfo::Capture()) {
        this->init(DSLModifiers(), returnType, name, std::move(parameters), pos);
    }

    DSLFunction(const DSLModifiers& modifiers, const DSLType& returnType, skstd::string_view name,
                SkTArray<DSLParameter*> parameters, PositionInfo pos = PositionInfo::Capture()) {
        this->init(modifiers, returnType, name, std::move(parameters), pos);
    }

    DSLFunction(const SkSL::FunctionDeclaration* decl)
        : fDecl(decl) {}

    virtual ~DSLFunction() = default;

    template<class... Stmt>
    void define(Stmt... stmts) {
        DSLBlock block = DSLBlock(DSLStatement(std::move(stmts))...);
        this->define(std::move(block));
    }

    void define(DSLBlock block, PositionInfo pos = PositionInfo::Capture());

    /**
     * Invokes the function with the given arguments.
     */
    template<class... Args>
    DSLExpression operator()(Args&&... args) {
        ExpressionArray argArray;
        argArray.reserve_back(sizeof...(args));
        this->collectArgs(argArray, std::forward<Args>(args)...);
        return this->call(std::move(argArray));
    }

    /**
     * Invokes the function with the given arguments.
     */
    DSLExpression call(SkTArray<DSLWrapper<DSLExpression>> args,
            PositionInfo pos = PositionInfo::Capture());

    DSLExpression call(ExpressionArray args, PositionInfo pos = PositionInfo::Capture());

private:
    void collectArgs(ExpressionArray& args) {}

    template<class... RemainingArgs>
    void collectArgs(ExpressionArray& args, DSLVar& var, RemainingArgs&&... remaining) {
        args.push_back(DSLExpression(var).release());
        collectArgs(args, std::forward<RemainingArgs>(remaining)...);
    }

    template<class... RemainingArgs>
    void collectArgs(ExpressionArray& args, DSLExpression expr, RemainingArgs&&... remaining) {
        args.push_back(expr.release());
        collectArgs(args, std::forward<RemainingArgs>(remaining)...);
    }

    void init(DSLModifiers modifiers, const DSLType& returnType, skstd::string_view name,
              SkTArray<DSLParameter*> params, PositionInfo pos);

    const SkSL::FunctionDeclaration* fDecl = nullptr;
    SkSL::PositionInfo fPosition;
};

} // namespace dsl

} // namespace SkSL

#endif
