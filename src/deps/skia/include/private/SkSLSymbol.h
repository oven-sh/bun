/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_SYMBOL
#define SKSL_SYMBOL

#include "include/private/SkSLIRNode.h"
#include "include/private/SkSLProgramElement.h"

namespace SkSL {

/**
 * Represents a symboltable entry.
 */
class Symbol : public IRNode {
public:
    enum class Kind {
        kExternal = (int) ProgramElement::Kind::kLast + 1,
        kField,
        kFunctionDeclaration,
        kType,
        kUnresolvedFunction,
        kVariable,

        kFirst = kExternal,
        kLast = kVariable
    };

    Symbol(int offset, Kind kind, skstd::string_view name, const Type* type = nullptr)
        : INHERITED(offset, (int) kind)
        , fName(name)
        , fType(type) {
        SkASSERT(kind >= Kind::kFirst && kind <= Kind::kLast);
    }

    ~Symbol() override {}

    const Type& type() const {
        SkASSERT(fType);
        return *fType;
    }

    Kind kind() const {
        return (Kind) fKind;
    }

    skstd::string_view name() const {
        return fName;
    }

    /**
     *  Use is<T> to check the type of a symbol.
     *  e.g. replace `sym.kind() == Symbol::Kind::kVariable` with `sym.is<Variable>()`.
     */
    template <typename T>
    bool is() const {
        return this->kind() == T::kSymbolKind;
    }

    /**
     *  Use as<T> to downcast symbols. e.g. replace `(Variable&) sym` with `sym.as<Variable>()`.
     */
    template <typename T>
    const T& as() const {
        SkASSERT(this->is<T>());
        return static_cast<const T&>(*this);
    }

    template <typename T>
    T& as() {
        SkASSERT(this->is<T>());
        return static_cast<T&>(*this);
    }

private:
    skstd::string_view fName;
    const Type* fType;

    using INHERITED = IRNode;

    friend class Type;
};

}  // namespace SkSL

#endif
