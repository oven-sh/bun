#pragma once
#include "root.h"
#include <mimalloc.h>

struct MiCString {
    const char* ptr;
    size_t length;
};

/// A string which is owned by mimalloc and can be mi_free'd
class MiString {
public:
    MiString(const char* ptr, size_t length)
        : m_span(ptr, length)
    {
    }

    ~MiString()
    {
        if (m_span.data()) {
            mi_free(const_cast<char*>(m_span.data()));
        }
    }

    // Delete copy constructor and assignment operator to prevent double free
    MiString(const MiString&) = delete;
    MiString& operator=(const MiString&) = delete;

    // Move constructor and assignment
    MiString(MiString&& other) noexcept
        : m_span(other.m_span)
    {
        other.m_span = {};
    }

    MiString& operator=(MiString&& other) noexcept
    {
        if (this != &other) {
            if (m_span.data()) {
                mi_free(const_cast<char*>(m_span.data()));
            }
            m_span = other.m_span;
            other.m_span = {};
        }
        return *this;
    }

    MiCString asCString() const
    {
        return MiCString { m_span.data(), m_span.size() };
    }

private:
    std::span<const char> m_span;
};
