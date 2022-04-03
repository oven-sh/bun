/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_STRING
#define SKSL_STRING

#include "include/core/SkStringView.h"
#include "include/private/SkSLDefines.h"
#include <cstring>
#include <stdarg.h>
#include <string>

#ifndef SKSL_STANDALONE
#include "include/core/SkString.h"
#endif

namespace SkSL {

class String;

class SK_API String : public std::string {
public:
    using std::string::string;

    explicit String(std::string s) : INHERITED(std::move(s)) {}
    explicit String(skstd::string_view s) : INHERITED(s.data(), s.length()) {}
    // TODO(johnstiles): add operator skstd::string_view

    static String printf(const char* fmt, ...) SK_PRINTF_LIKE(1, 2);
    void appendf(const char* fmt, ...) SK_PRINTF_LIKE(2, 3);
    void vappendf(const char* fmt, va_list va);

    bool starts_with(const char prefix[]) const {
        return skstd::string_view(data(), size()).starts_with(prefix);
    }
    bool ends_with(const char suffix[]) const {
        return skstd::string_view(data(), size()).ends_with(suffix);
    }

    bool consumeSuffix(const char suffix[]);

    String operator+(const char* s) const;
    String operator+(const String& s) const;
    String operator+(skstd::string_view s) const;
    String& operator+=(char c);
    String& operator+=(const char* s);
    String& operator+=(const String& s);
    String& operator+=(skstd::string_view s);
    friend String operator+(const char* s1, const String& s2);

private:
    using INHERITED = std::string;
};

String operator+(skstd::string_view left, skstd::string_view right);

String to_string(double value);
String to_string(int32_t value);
String to_string(uint32_t value);
String to_string(int64_t value);
String to_string(uint64_t value);

bool stod(skstd::string_view s, SKSL_FLOAT* value);
bool stoi(skstd::string_view s, SKSL_INT* value);

} // namespace SkSL

namespace std {
    template<> struct hash<SkSL::String> {
        size_t operator()(const SkSL::String& s) const {
            return hash<std::string>{}(s);
        }
    };
} // namespace std

#endif
