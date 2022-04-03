/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_DSL_VAR
#define SKSL_DSL_VAR

#include "include/sksl/DSLExpression.h"
#include "include/sksl/DSLModifiers.h"
#include "include/sksl/DSLType.h"

namespace SkSL {

class Expression;
class IRGenerator;
class SPIRVCodeGenerator;
class Variable;
enum class VariableStorage : int8_t;

namespace dsl {

class DSLVarBase {
public:
    /**
     * Creates an empty, unpopulated var. Can be replaced with a real var later via `swap`.
     */
    DSLVarBase() : fType(kVoid_Type), fDeclared(true) {}

    /**
     * Constructs a new variable with the specified type and name. The name is used (in mangled
     * form) in the resulting shader code; it is not otherwise important. Since mangling prevents
     * name conflicts and the variable's name is only important when debugging shaders, the name
     * parameter is optional.
     */
    DSLVarBase(DSLType type, skstd::string_view name, DSLExpression initialValue, PositionInfo pos);

    DSLVarBase(DSLType type, DSLExpression initialValue, PositionInfo pos);

    DSLVarBase(const DSLModifiers& modifiers, DSLType type, skstd::string_view name,
               DSLExpression initialValue, PositionInfo pos);

    DSLVarBase(const DSLModifiers& modifiers, DSLType type, DSLExpression initialValue,
               PositionInfo pos);

    DSLVarBase(DSLVarBase&&) = default;

    virtual ~DSLVarBase();

    skstd::string_view name() const {
        return fName;
    }

    const DSLModifiers& modifiers() const {
        return fModifiers;
    }

    virtual VariableStorage storage() const = 0;

    DSLExpression x() {
        return DSLExpression(*this, PositionInfo()).x();
    }

    DSLExpression y() {
        return DSLExpression(*this, PositionInfo()).y();
    }

    DSLExpression z() {
        return DSLExpression(*this, PositionInfo()).z();
    }

    DSLExpression w() {
        return DSLExpression(*this, PositionInfo()).w();
    }

    DSLExpression r() {
        return DSLExpression(*this, PositionInfo()).r();
    }

    DSLExpression g() {
        return DSLExpression(*this, PositionInfo()).g();
    }

    DSLExpression b() {
        return DSLExpression(*this, PositionInfo()).b();
    }

    DSLExpression a() {
        return DSLExpression(*this, PositionInfo()).a();
    }

    DSLExpression field(skstd::string_view name) {
        return DSLExpression(*this, PositionInfo()).field(name);
    }

    DSLPossibleExpression operator[](DSLExpression&& index);

    DSLPossibleExpression operator++() {
        return ++DSLExpression(*this, PositionInfo());
    }

    DSLPossibleExpression operator++(int) {
        return DSLExpression(*this, PositionInfo())++;
    }

    DSLPossibleExpression operator--() {
        return --DSLExpression(*this, PositionInfo());
    }

    DSLPossibleExpression operator--(int) {
        return DSLExpression(*this, PositionInfo())--;
    }

protected:
    DSLPossibleExpression assign(DSLExpression other);

    void swap(DSLVarBase& other);

    DSLModifiers fModifiers;
    // We only need to keep track of the type here so that we can create the SkSL::Variable. For
    // predefined variables this field is unnecessary, so we don't bother tracking it and just set
    // it to kVoid; in other words, you shouldn't generally be relying on this field to be correct.
    // If you need to determine the variable's type, look at DSLWriter::Var(...)->type() instead.
    DSLType fType;
    int fUniformHandle = -1;
    std::unique_ptr<SkSL::Statement> fDeclaration;
    const SkSL::Variable* fVar = nullptr;
    skstd::string_view fRawName; // for error reporting
    skstd::string_view fName;
    DSLExpression fInitialValue;
    // true if we have attempted to create the SkSL var
    bool fInitialized = false;
    bool fDeclared = false;
    PositionInfo fPosition;

    friend class DSLCore;
    friend class DSLExpression;
    friend class DSLFunction;
    friend class DSLWriter;
    friend class ::SkSL::IRGenerator;
    friend class ::SkSL::SPIRVCodeGenerator;
};

/**
 * A local variable.
 */
class DSLVar : public DSLVarBase {
public:
    DSLVar() = default;

    DSLVar(DSLType type, skstd::string_view name = "var",
           DSLExpression initialValue = DSLExpression(),
           PositionInfo pos = PositionInfo::Capture())
        : INHERITED(type, name, std::move(initialValue), pos) {}

    DSLVar(DSLType type, const char* name, DSLExpression initialValue = DSLExpression(),
           PositionInfo pos = PositionInfo::Capture())
        : DSLVar(type, skstd::string_view(name), std::move(initialValue), pos) {}

    DSLVar(DSLType type, DSLExpression initialValue, PositionInfo pos = PositionInfo::Capture())
        : INHERITED(type, std::move(initialValue), pos) {}

    DSLVar(const DSLModifiers& modifiers, DSLType type, skstd::string_view name = "var",
           DSLExpression initialValue = DSLExpression(), PositionInfo pos = PositionInfo::Capture())
        : INHERITED(modifiers, type, name, std::move(initialValue), pos) {}

    DSLVar(const DSLModifiers& modifiers, DSLType type, const char* name,
           DSLExpression initialValue = DSLExpression(), PositionInfo pos = PositionInfo::Capture())
        : DSLVar(modifiers, type, skstd::string_view(name), std::move(initialValue), pos) {}

    DSLVar(DSLVar&&) = default;

    VariableStorage storage() const override;

    void swap(DSLVar& other);

    DSLPossibleExpression operator=(DSLExpression expr);

    DSLPossibleExpression operator=(DSLVar& param) {
        return this->operator=(DSLExpression(param));
    }

    template<class Param>
    DSLPossibleExpression operator=(Param& param) {
        return this->operator=(DSLExpression(param));
    }

private:
    using INHERITED = DSLVarBase;
};

/**
 * A global variable.
 */
class DSLGlobalVar : public DSLVarBase {
public:
    DSLGlobalVar() = default;

    DSLGlobalVar(DSLType type, skstd::string_view name = "var",
           DSLExpression initialValue = DSLExpression(), PositionInfo pos = PositionInfo::Capture())
        : INHERITED(type, name, std::move(initialValue), pos) {}

    DSLGlobalVar(DSLType type, const char* name, DSLExpression initialValue = DSLExpression(),
                 PositionInfo pos = PositionInfo::Capture())
        : DSLGlobalVar(type, skstd::string_view(name), std::move(initialValue), pos) {}

    DSLGlobalVar(DSLType type, DSLExpression initialValue,
                 PositionInfo pos = PositionInfo::Capture())
        : INHERITED(type, std::move(initialValue), pos) {}

    DSLGlobalVar(const DSLModifiers& modifiers, DSLType type, skstd::string_view name = "var",
           DSLExpression initialValue = DSLExpression(), PositionInfo pos = PositionInfo::Capture())
        : INHERITED(modifiers, type, name, std::move(initialValue), pos) {}

    DSLGlobalVar(const DSLModifiers& modifiers, DSLType type, const char* name,
           DSLExpression initialValue = DSLExpression(), PositionInfo pos = PositionInfo::Capture())
        : DSLGlobalVar(modifiers, type, skstd::string_view(name), std::move(initialValue), pos) {}

    DSLGlobalVar(const char* name);

    DSLGlobalVar(DSLGlobalVar&&) = default;

    VariableStorage storage() const override;

    void swap(DSLGlobalVar& other);

    DSLPossibleExpression operator=(DSLExpression expr);

    DSLPossibleExpression operator=(DSLGlobalVar& param) {
        return this->operator=(DSLExpression(param));
    }

    template<class Param>
    DSLPossibleExpression operator=(Param& param) {
        return this->operator=(DSLExpression(param));
    }

    /**
     * Implements the following method calls:
     *     half4 shader::eval(float2 coords);
     *     half4 colorFilter::eval(half4 input);
     */
    DSLExpression eval(DSLExpression x, PositionInfo pos = PositionInfo::Capture());

    /**
     * Implements the following method call:
     *     half4 blender::eval(half4 src, half4 dst);
     */
    DSLExpression eval(DSLExpression x, DSLExpression y,
            PositionInfo pos = PositionInfo::Capture());

private:
    DSLExpression eval(ExpressionArray args, PositionInfo pos);

    std::unique_ptr<SkSL::Expression> methodCall(skstd::string_view methodName, PositionInfo pos);

    using INHERITED = DSLVarBase;
};

/**
 * A function parameter.
 */
class DSLParameter : public DSLVarBase {
public:
    DSLParameter() = default;

    DSLParameter(DSLType type, skstd::string_view name = "var",
                 PositionInfo pos = PositionInfo::Capture())
        : INHERITED(type, name, DSLExpression(), pos) {}

    DSLParameter(DSLType type, const char* name, PositionInfo pos = PositionInfo::Capture())
        : DSLParameter(type, skstd::string_view(name), pos) {}

    DSLParameter(const DSLModifiers& modifiers, DSLType type, skstd::string_view name = "var",
                 PositionInfo pos = PositionInfo::Capture())
        : INHERITED(modifiers, type, name, DSLExpression(), pos) {}

    DSLParameter(const DSLModifiers& modifiers, DSLType type, const char* name,
                 PositionInfo pos = PositionInfo::Capture())
        : DSLParameter(modifiers, type, skstd::string_view(name), pos) {}

    DSLParameter(DSLParameter&&) = default;

    VariableStorage storage() const override;

    void swap(DSLParameter& other);

    DSLPossibleExpression operator=(DSLExpression expr);

    DSLPossibleExpression operator=(DSLParameter& param) {
        return this->operator=(DSLExpression(param));
    }

    template<class Param>
    DSLPossibleExpression operator=(Param& param) {
        return this->operator=(DSLExpression(param));
    }

private:
    using INHERITED = DSLVarBase;
};

} // namespace dsl

} // namespace SkSL


#endif
