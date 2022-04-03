/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkFlattenable_DEFINED
#define SkFlattenable_DEFINED

#include "include/core/SkRefCnt.h"

class SkData;
class SkReadBuffer;
class SkWriteBuffer;

struct SkSerialProcs;
struct SkDeserialProcs;

/** \class SkFlattenable

 SkFlattenable is the base class for objects that need to be flattened
 into a data stream for either transport or as part of the key to the
 font cache.
 */
class SK_API SkFlattenable : public SkRefCnt {
public:
    enum Type {
        kSkColorFilter_Type,
        kSkBlender_Type,
        kSkDrawable_Type,
        kSkDrawLooper_Type,  // no longer used internally by Skia
        kSkImageFilter_Type,
        kSkMaskFilter_Type,
        kSkPathEffect_Type,
        kSkShader_Type,
    };

    typedef sk_sp<SkFlattenable> (*Factory)(SkReadBuffer&);

    SkFlattenable() {}

    /** Implement this to return a factory function pointer that can be called
     to recreate your class given a buffer (previously written to by your
     override of flatten().
     */
    virtual Factory getFactory() const = 0;

    /**
     *  Returns the name of the object's class.
     */
    virtual const char* getTypeName() const = 0;

    static Factory NameToFactory(const char name[]);
    static const char* FactoryToName(Factory);

    static void Register(const char name[], Factory);

    /**
     *  Override this if your subclass needs to record data that it will need to recreate itself
     *  from its CreateProc (returned by getFactory()).
     *
     *  DEPRECATED public : will move to protected ... use serialize() instead
     */
    virtual void flatten(SkWriteBuffer&) const {}

    virtual Type getFlattenableType() const = 0;

    //
    // public ways to serialize / deserialize
    //
    sk_sp<SkData> serialize(const SkSerialProcs* = nullptr) const;
    size_t serialize(void* memory, size_t memory_size,
                     const SkSerialProcs* = nullptr) const;
    static sk_sp<SkFlattenable> Deserialize(Type, const void* data, size_t length,
                                            const SkDeserialProcs* procs = nullptr);

protected:
    class PrivateInitializer {
    public:
        static void InitEffects();
        static void InitImageFilters();
    };

private:
    static void RegisterFlattenablesIfNeeded();
    static void Finalize();

    friend class SkGraphics;

    using INHERITED = SkRefCnt;
};

#if defined(SK_DISABLE_EFFECT_DESERIALIZATION)
    #define SK_REGISTER_FLATTENABLE(type) do{}while(false)

    #define SK_FLATTENABLE_HOOKS(type)                                   \
        static sk_sp<SkFlattenable> CreateProc(SkReadBuffer&);           \
        friend class SkFlattenable::PrivateInitializer;                  \
        Factory getFactory() const override { return nullptr; }          \
        const char* getTypeName() const override { return #type; }
#else
    #define SK_REGISTER_FLATTENABLE(type)                                \
        SkFlattenable::Register(#type, type::CreateProc)

    #define SK_FLATTENABLE_HOOKS(type)                                   \
        static sk_sp<SkFlattenable> CreateProc(SkReadBuffer&);           \
        friend class SkFlattenable::PrivateInitializer;                  \
        Factory getFactory() const override { return type::CreateProc; } \
        const char* getTypeName() const override { return #type; }
#endif

#endif
