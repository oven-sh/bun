/*
 * Copyright (C) 2016-2019 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

// Copied from WebKit's Source/WTF/wtf/BlockPtr.h; see ../README.md.
#pragma once

#include <wtf/Platform.h>

#if OS(DARWIN)

#include <Block.h>
#include <utility>
#include <wtf/Assertions.h>
#include <wtf/StdLibExtras.h>

#if __has_include(<ptrauth.h>)
#include <ptrauth.h>

#ifdef __ptrauth_block_copy_helper
#define WTF_COPY_FUNCTION_POINTER_QUALIFIER __ptrauth_block_copy_helper
#else
#define WTF_COPY_FUNCTION_POINTER_QUALIFIER
#endif

#ifdef __ptrauth_block_destroy_helper
#define WTF_DISPOSE_FUNCTION_POINTER_QUALIFIER __ptrauth_block_destroy_helper
#else
#define WTF_DISPOSE_FUNCTION_POINTER_QUALIFIER
#endif

#ifdef __ptrauth_block_invocation_pointer
#define WTF_INVOKE_FUNCTION_POINTER_QUALIFIER __ptrauth_block_invocation_pointer
#else
#define WTF_INVOKE_FUNCTION_POINTER_QUALIFIER
#endif

#ifdef __ptrauth_objc_isa_pointer
#define WTF_ISA_POINTER_QUALIFIER __ptrauth_objc_isa_pointer
#else
#define WTF_ISA_POINTER_QUALIFIER
#endif

#else

#define WTF_COPY_FUNCTION_POINTER_QUALIFIER
#define WTF_DISPOSE_FUNCTION_POINTER_QUALIFIER
#define WTF_INVOKE_FUNCTION_POINTER_QUALIFIER
#define WTF_ISA_POINTER_QUALIFIER

#endif

// Because ARC enablement is a compile-time choice, and we compile this header
// both ways, we need a separate copy of our code when ARC is enabled.
#if __has_feature(objc_arc)
#define BlockPtr BlockPtrArc
#define makeBlockPtr makeBlockPtrArc
#endif

namespace WTF {

extern "C" void* _NSConcreteMallocBlock[32];

template<typename> class BlockPtr;

template<typename R, typename... Args>
class BlockPtr<R (Args...)> {
public:
    using BlockType = R (^)(Args...);

    template<typename F>
    static BlockPtr fromCallable(F function)
    {
        struct Descriptor {
            uintptr_t reserved;
            uintptr_t size;
            void (*WTF_COPY_FUNCTION_POINTER_QUALIFIER copy)(void *dst, const void *src);
            void (*WTF_DISPOSE_FUNCTION_POINTER_QUALIFIER dispose)(const void *);
        };

        struct Block {
            void* WTF_ISA_POINTER_QUALIFIER isa;
            int32_t flags;
            int32_t reserved;
            R (*WTF_INVOKE_FUNCTION_POINTER_QUALIFIER invoke)(void *, Args...);
            const struct Descriptor* descriptor;
            F f;
        };

        static const Descriptor descriptor {
            0,
            sizeof(Block),

            // We keep the copy function null - the block is already on the heap
            // so it should never be copied.
            nullptr,

            [](const void* ptr) {
                static_cast<Block*>(const_cast<void*>(ptr))->f.~F();
            }
        };

        Block* block = static_cast<Block*>(malloc(sizeof(Block)));
        block->isa = _NSConcreteMallocBlock;

        enum {
            BLOCK_NEEDS_FREE = (1 << 24),
            BLOCK_HAS_COPY_DISPOSE = (1 << 25),
        };
        const unsigned retainCount = 1;

        block->flags = BLOCK_HAS_COPY_DISPOSE | BLOCK_NEEDS_FREE | (retainCount << 1);
        block->reserved = 0;
        block->invoke = [](void *ptr, Args... args) -> R {
            return static_cast<Block*>(ptr)->f(std::forward<Args>(args)...);
        };
        block->descriptor = &descriptor;

        new (&block->f) F { std::move(function) };

#if __has_feature(objc_arc)
        return BlockPtr { (__bridge_transfer BlockType)block };
#else
        BlockPtr blockPtr;
        blockPtr.m_block = reinterpret_cast<BlockType>(block);
        return blockPtr;
#endif
    }

    BlockPtr()
        : m_block(nullptr)
    {
    }

    BlockPtr(BlockType block)
#if __has_feature(objc_arc)
        : m_block(block)
#else
        : m_block(Block_copy(block))
#endif
    {
    }

    BlockPtr(const BlockPtr& other)
#if __has_feature(objc_arc)
        : m_block(other.m_block)
#else
        : m_block(Block_copy(other.m_block))
#endif
    {
    }
    
    BlockPtr(BlockPtr&& other)
        : m_block(std::exchange(other.m_block, nullptr))
    {
    }
    
    ~BlockPtr()
    {
#if !__has_feature(objc_arc)
        Block_release(m_block);
#endif
    }

    BlockPtr& operator=(const BlockPtr& other)
    {
#if __has_feature(objc_arc)
        m_block = other.m_block;
#else
        if (this != &other) {
            Block_release(m_block);
            m_block = Block_copy(other.m_block);
        }
#endif

        return *this;
    }

    BlockPtr& operator=(BlockPtr&& other)
    {
        BlockPtr moved(std::move(other));
        std::swap(m_block, moved.m_block);
        return *this;
    }

    BlockType get() const { return m_block; }

    explicit operator bool() const { return m_block; }
    bool operator!() const { return !m_block; }

    R operator()(Args... arguments) const
    {
        ASSERT(m_block);
        
        return m_block(std::forward<Args>(arguments)...);
    }

private:
    BlockType m_block;
};

template<typename R, typename... Args>
inline BlockPtr<R (Args...)> makeBlockPtr(R (^block)(Args...))
{
    return BlockPtr<R (Args...)>(block);
}

template<typename F, typename Class, typename R, typename... Args>
inline auto makeBlockPtr(F&& function, R (Class::*)(Args...) const)
{
    return BlockPtr<R (Args...)>::fromCallable(std::forward<F>(function));
}

template<typename F, typename Class, typename R, typename... Args>
inline auto makeBlockPtr(F&& function, R (Class::*)(Args...))
{
    return BlockPtr<R (Args...)>::fromCallable(std::forward<F>(function));
}

template<typename F>
inline auto makeBlockPtr(F&& function)
{
    return makeBlockPtr(std::forward<F>(function), &F::operator());
}

}

using WTF::BlockPtr;
using WTF::makeBlockPtr;

#endif // OS(DARWIN)
