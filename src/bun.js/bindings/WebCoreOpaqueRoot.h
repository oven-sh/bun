/*
 * Copyright (C) 2022 Apple Inc. All Rights Reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

#pragma once

namespace WebCore {

class WebCoreOpaqueRoot {
public:
    template<typename T, typename = typename std::enable_if_t<!std::is_same_v<T, void>>>
    explicit WebCoreOpaqueRoot(T* pointer)
        : m_pointer(static_cast<void*>(pointer))
    {
    }

    WebCoreOpaqueRoot(std::nullptr_t) {}

    bool isNode() const { return false; }
    void* pointer() const { return m_pointer; }

private:
    void* m_pointer { nullptr };
    bool m_isNode { false };
};

template<typename Visitor>
ALWAYS_INLINE void addWebCoreOpaqueRoot(Visitor& visitor, WebCoreOpaqueRoot root)
{
    visitor.addOpaqueRoot(root.pointer());
}

template<typename Visitor, typename ImplType>
ALWAYS_INLINE void addWebCoreOpaqueRoot(Visitor& visitor, ImplType* impl)
{
    addWebCoreOpaqueRoot(visitor, root(impl));
}

template<typename Visitor, typename ImplType>
ALWAYS_INLINE void addWebCoreOpaqueRoot(Visitor& visitor, ImplType& impl)
{
    addWebCoreOpaqueRoot(visitor, root(&impl));
}

template<typename Visitor>
ALWAYS_INLINE bool containsWebCoreOpaqueRoot(Visitor& visitor, WebCoreOpaqueRoot root)
{
    return visitor.containsOpaqueRoot(root.pointer());
}

template<typename Visitor, typename ImplType>
ALWAYS_INLINE bool containsWebCoreOpaqueRoot(Visitor& visitor, ImplType& impl)
{
    return containsWebCoreOpaqueRoot(visitor, root(&impl));
}

template<typename Visitor, typename ImplType>
ALWAYS_INLINE bool containsWebCoreOpaqueRoot(Visitor& visitor, ImplType* impl)
{
    return containsWebCoreOpaqueRoot(visitor, root(impl));
}

} // namespace WebCore
