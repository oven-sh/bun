/*
 * Copyright 2021 Google LLC.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkStringView_DEFINED
#define SkStringView_DEFINED

#include <algorithm>
#include <cstring>
#include <string>

namespace skstd {

class string_view {
public:
    using value_type = char;
    using traits_type = std::char_traits<value_type>;
    using const_pointer = const value_type*;
    using const_reference = const value_type&;
    using iterator = const_pointer;
    using const_iterator = iterator;
    using size_type = size_t;
    static constexpr size_type npos = size_type(-1);

    constexpr string_view()
        : fData(nullptr)
        , fLength(0) {}

    constexpr string_view(const string_view&) = default;

    constexpr string_view(const_pointer data, size_type length)
        : fData(data)
        , fLength(length) {}

    string_view(const_pointer data)
        : string_view(data, strlen(data)) {}

    string_view(const std::string& str)
        : string_view(str.data(), str.length()) {}

    constexpr string_view& operator=(const string_view&) = default;

    constexpr iterator begin() const {
        return fData;
    }

    constexpr iterator end() const {
        return fData + fLength;
    }

    constexpr const_reference operator[](size_type idx) const {
        return fData[idx];
    }

    constexpr const_reference front() const {
        return fData[0];
    }

    constexpr const_reference back() const {
        return fData[fLength - 1];
    }

    constexpr const_pointer data() const {
        return fData;
    }

    constexpr size_type size() const {
        return fLength;
    }

    constexpr size_type length() const {
        return fLength;
    }

    constexpr bool empty() const {
        return fLength == 0;
    }

    constexpr bool starts_with(string_view s) const {
        if (s.length() > fLength) {
            return false;
        }
        return s.length() == 0 || !memcmp(fData, s.fData, s.length());
    }

    constexpr bool starts_with(value_type c) const {
        return !this->empty() && this->front() == c;
    }

    constexpr bool ends_with(string_view s) const {
        if (s.length() > fLength) {
            return false;
        }
        return s.length() == 0 || !memcmp(this->end() - s.length(), s.fData, s.length());
    }

    constexpr bool ends_with(value_type c) const {
        return !this->empty() && this->back() == c;
    }

    size_type find(string_view needle, size_type pos = 0) const {
        if (needle.length() == 0) {
            return 0;
        }
        if (this->length() < needle.length()) {
            return npos;
        }
        const char* match = nullptr;
        const char* start = this->data() + pos;
        const char* end = start + this->length() - needle.length() + 1;
        while ((match = (const char*)(memchr(start, needle[0], (size_t)(end - start))))) {
            if (!memcmp(match, needle.data(), needle.length())) {
                return (size_type)(match - this->data());
            } else {
                start = match + 1;
            }
        }
        return npos;
    }

    bool contains(string_view needle) const {
        return this->find(needle) != npos;
    }

    constexpr string_view substr(size_type pos = 0, size_type count = npos) const {
        if (pos > fLength) {
            return {};
        }
        return string_view{fData + pos, std::min(count, fLength - pos)};
    }

    constexpr void swap(string_view& other) {
        const_pointer tempData = fData;
        fData = other.fData;
        other.fData = tempData;

        size_type tempLength = fLength;
        fLength = other.fLength;
        other.fLength = tempLength;
    }

    constexpr void remove_prefix(size_type n) {
        fData += n;
        fLength -= n;
    }

    constexpr void remove_suffix(size_type n) {
        fLength -= n;
    }

private:
    const_pointer fData;
    size_type fLength;
};

bool operator==(string_view left, string_view right);

bool operator!=(string_view left, string_view right);

bool operator<(string_view left, string_view right);

bool operator<=(string_view left, string_view right);

bool operator>(string_view left, string_view right);

bool operator>=(string_view left, string_view right);

} // namespace skstd

namespace std {
    template<> struct hash<skstd::string_view> {
        size_t operator()(const skstd::string_view& s) const {
            size_t result = 0;
            for (auto iter = s.begin(); iter != s.end(); ++iter) {
                result = result * 101 + (size_t) *iter;
            }
            return result;
        }
    };
} // namespace std

#endif
