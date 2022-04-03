/*
 * Copyright 2021 Google LLC.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_DSL_WRAPPER
#define SKSL_DSL_WRAPPER

#include <memory>

namespace SkSL {

namespace dsl {

/**
 * Several of the DSL classes override operator= in a non-standard fashion to allow for expressions
 * like "x = 0" to compile into SkSL code. This makes it impossible to directly use these classes in
 * C++ containers which expect standard behavior for operator=.
 *
 * Wrapper<T> contains a T, where T is a DSL class with non-standard operator=, and provides
 * standard behavior for operator=, permitting it to be used in standard containers.
 */
template<typename T>
class DSLWrapper {
public:
    DSLWrapper(T value) {
        fValue.swap(value);
    }

    DSLWrapper(const DSLWrapper&) = delete;

    DSLWrapper(DSLWrapper&& other) {
        fValue.swap(other.fValue);
    }

    T& get() {
        return fValue;
    }

    T& operator*() {
        return fValue;
    }

    T* operator->() {
        return &fValue;
    }

    const T& get() const {
        return fValue;
    }

    const T& operator*() const {
        return fValue;
    }

    const T* operator->() const {
        return &fValue;
    }

    DSLWrapper& operator=(const DSLWrapper&) = delete;

    DSLWrapper& operator=(DSLWrapper&& other) {
        fValue.swap(other.fValue);
        return *this;
    }

private:
    T fValue;
};

} // namespace dsl

} // namespace SkSL

#endif
