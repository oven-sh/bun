/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_DSL_EXPRESSION
#define SKSL_DSL_EXPRESSION

#include "include/core/SkStringView.h"
#include "include/core/SkTypes.h"
#include "include/private/SkTArray.h"
#include "include/sksl/DSLWrapper.h"
#include "include/sksl/SkSLErrorReporter.h"

#include <cstdint>
#include <memory>

#if defined(__has_cpp_attribute) && __has_cpp_attribute(clang::reinitializes)
#define SK_CLANG_REINITIALIZES [[clang::reinitializes]]
#else
#define SK_CLANG_REINITIALIZES
#endif

namespace SkSL {

class Expression;
class Type;

namespace dsl {

class DSLPossibleExpression;
class DSLStatement;
class DSLType;
class DSLVarBase;

/**
 * Represents an expression such as 'cos(x)' or 'a + b'.
 */
class DSLExpression {
public:
    DSLExpression(const DSLExpression&) = delete;

    DSLExpression(DSLExpression&&);

    DSLExpression();

    /**
     * Creates an expression representing a literal float.
     */
    DSLExpression(float value, PositionInfo pos = PositionInfo::Capture());

    /**
     * Creates an expression representing a literal float.
     */
    DSLExpression(double value, PositionInfo pos = PositionInfo::Capture())
        : DSLExpression((float) value) {}

    /**
     * Creates an expression representing a literal int.
     */
    DSLExpression(int value, PositionInfo pos = PositionInfo::Capture());

    /**
     * Creates an expression representing a literal int.
     */
    DSLExpression(int64_t value, PositionInfo pos = PositionInfo::Capture());

    /**
     * Creates an expression representing a literal uint.
     */
    DSLExpression(unsigned int value, PositionInfo pos = PositionInfo::Capture());

    /**
     * Creates an expression representing a literal bool.
     */
    DSLExpression(bool value, PositionInfo pos = PositionInfo::Capture());

    /**
     * Creates an expression representing a variable reference.
     */
    DSLExpression(DSLVarBase& var, PositionInfo pos = PositionInfo::Capture());

    DSLExpression(DSLVarBase&& var, PositionInfo pos = PositionInfo::Capture());

    DSLExpression(DSLPossibleExpression expr, PositionInfo pos = PositionInfo::Capture());

    explicit DSLExpression(std::unique_ptr<SkSL::Expression> expression);

    static DSLExpression Poison(PositionInfo pos = PositionInfo::Capture());

    ~DSLExpression();

    DSLType type();

    /**
     * Overloads the '=' operator to create an SkSL assignment statement.
     */
    DSLPossibleExpression operator=(DSLExpression other);

    DSLExpression x(PositionInfo pos = PositionInfo::Capture());

    DSLExpression y(PositionInfo pos = PositionInfo::Capture());

    DSLExpression z(PositionInfo pos = PositionInfo::Capture());

    DSLExpression w(PositionInfo pos = PositionInfo::Capture());

    DSLExpression r(PositionInfo pos = PositionInfo::Capture());

    DSLExpression g(PositionInfo pos = PositionInfo::Capture());

    DSLExpression b(PositionInfo pos = PositionInfo::Capture());

    DSLExpression a(PositionInfo pos = PositionInfo::Capture());

    /**
     * Creates an SkSL struct field access expression.
     */
    DSLExpression field(skstd::string_view name, PositionInfo pos = PositionInfo::Capture());

    /**
     * Creates an SkSL array index expression.
     */
    DSLPossibleExpression operator[](DSLExpression index);

    DSLPossibleExpression operator()(SkTArray<DSLWrapper<DSLExpression>> args,
                                     PositionInfo pos = PositionInfo::Capture());

    DSLPossibleExpression operator()(ExpressionArray args,
                                     PositionInfo pos = PositionInfo::Capture());

    /**
     * Returns true if this object contains an expression. DSLExpressions which were created with
     * the empty constructor or which have already been release()ed do not have a value.
     * DSLExpressions created with errors are still considered to have a value (but contain poison).
     */
    bool hasValue() const {
        return fExpression != nullptr;
    }

    /**
     * Returns true if this object contains an expression which is not poison.
     */
    bool isValid() const;

    SK_CLANG_REINITIALIZES void swap(DSLExpression& other);

    /**
     * Invalidates this object and returns the SkSL expression it represents. It is an error to call
     * this on an invalid DSLExpression.
     */
    std::unique_ptr<SkSL::Expression> release();

private:
    /**
     * Calls release if this expression has a value, otherwise returns null.
     */
    std::unique_ptr<SkSL::Expression> releaseIfPossible();

    std::unique_ptr<SkSL::Expression> fExpression;

    friend DSLExpression SampleChild(int index, DSLExpression coords);

    friend class DSLCore;
    friend class DSLFunction;
    friend class DSLPossibleExpression;
    friend class DSLType;
    friend class DSLVarBase;
    friend class DSLWriter;
    template<typename T> friend class DSLWrapper;
};

DSLPossibleExpression operator+(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator+(DSLExpression expr);
DSLPossibleExpression operator+=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator-(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator-(DSLExpression expr);
DSLPossibleExpression operator-=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator*(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator*=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator/(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator/=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator%(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator%=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator<<(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator<<=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator>>(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator>>=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator&&(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator||(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator&(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator&=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator|(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator|=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator^(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator^=(DSLExpression left, DSLExpression right);
DSLPossibleExpression LogicalXor(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator,(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator,(DSLPossibleExpression left, DSLExpression right);
DSLPossibleExpression operator,(DSLExpression left, DSLPossibleExpression right);
DSLPossibleExpression operator,(DSLPossibleExpression left, DSLPossibleExpression right);
DSLPossibleExpression operator==(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator!=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator>(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator<(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator>=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator<=(DSLExpression left, DSLExpression right);
DSLPossibleExpression operator!(DSLExpression expr);
DSLPossibleExpression operator~(DSLExpression expr);
DSLPossibleExpression operator++(DSLExpression expr);
DSLPossibleExpression operator++(DSLExpression expr, int);
DSLPossibleExpression operator--(DSLExpression expr);
DSLPossibleExpression operator--(DSLExpression expr, int);

/**
 * Represents an Expression which may have failed and/or have pending errors to report. Converting a
 * PossibleExpression into an Expression requires PositionInfo so that any pending errors can be
 * reported at the correct position.
 *
 * PossibleExpression is used instead of Expression in situations where it is not possible to
 * capture the PositionInfo at the time of Expression construction (notably in operator overloads,
 * where we cannot add default parameters).
 */
class DSLPossibleExpression {
public:
    DSLPossibleExpression(std::unique_ptr<SkSL::Expression> expression);

    DSLPossibleExpression(DSLPossibleExpression&& other);

    ~DSLPossibleExpression();

    bool valid() const {
        return fExpression != nullptr;
    }

    /**
     * Reports any pending errors at the specified position.
     */
    void reportErrors(PositionInfo pos);

    DSLType type();

    DSLExpression x(PositionInfo pos = PositionInfo::Capture());

    DSLExpression y(PositionInfo pos = PositionInfo::Capture());

    DSLExpression z(PositionInfo pos = PositionInfo::Capture());

    DSLExpression w(PositionInfo pos = PositionInfo::Capture());

    DSLExpression r(PositionInfo pos = PositionInfo::Capture());

    DSLExpression g(PositionInfo pos = PositionInfo::Capture());

    DSLExpression b(PositionInfo pos = PositionInfo::Capture());

    DSLExpression a(PositionInfo pos = PositionInfo::Capture());

    DSLExpression field(skstd::string_view name, PositionInfo pos = PositionInfo::Capture());

    DSLPossibleExpression operator=(DSLExpression expr);

    DSLPossibleExpression operator=(int expr);

    DSLPossibleExpression operator=(float expr);

    DSLPossibleExpression operator=(double expr);

    DSLPossibleExpression operator[](DSLExpression index);

    DSLPossibleExpression operator()(SkTArray<DSLWrapper<DSLExpression>> args,
                                     PositionInfo pos = PositionInfo::Capture());

    DSLPossibleExpression operator()(ExpressionArray args,
                                     PositionInfo pos = PositionInfo::Capture());

    DSLPossibleExpression operator++();

    DSLPossibleExpression operator++(int);

    DSLPossibleExpression operator--();

    DSLPossibleExpression operator--(int);

    std::unique_ptr<SkSL::Expression> release(PositionInfo pos = PositionInfo::Capture());

private:
    std::unique_ptr<SkSL::Expression> fExpression;

    friend class DSLExpression;
};

} // namespace dsl

} // namespace SkSL

#endif
