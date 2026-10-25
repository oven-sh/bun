#pragma once

#include <JavaScriptCore/AOTImageText.h>
#include <JavaScriptCore/AOTWire.h>
#include <cstddef>
#include <cstdint>

namespace JSC {
class JSGlobalObject;
namespace AOT {
struct ExternalFunctionBodies;
struct HostThreadPool;
}
}

struct BunAOTBytes {
    const uint8_t* ptr;
    size_t len;
};

struct BunAOTImageFile {
    intptr_t descriptor; // A HANDLE on Windows.
    int64_t offset;
};

struct BunAOTResult;

#if ENABLE(AOT)
// BunAOTCompile.cpp
extern "C" void Bun__AOT__initializeOptions(JSC::AOT::Wire::CompileOptions*);
extern "C" size_t Bun__AOT__applyOptionWord(JSC::AOT::Wire::CompileOptions*, BunAOTBytes word, uint8_t* message, size_t capacity);
extern "C" BunAOTResult* Bun__AOT__compile(BunAOTBytes program, const JSC::AOT::ExternalFunctionBodies*, void (*releaseProgram)(void* owner), void* programOwner, const JSC::AOT::Wire::CompileOptions*, const JSC::AOT::HostThreadPool*);
extern "C" BunAOTBytes Bun__AOT__resultSection(const BunAOTResult*, JSC::AOT::Wire::ResultSection);
extern "C" void Bun__AOT__freeResult(BunAOTResult*);
extern "C" size_t Bun__AOT__imageAlignment();
extern "C" void Bun__AOT__relocateImage(uint8_t* image, size_t size, uint64_t address);
extern "C" size_t Bun__AOT__operationCount();
extern "C" BunAOTBytes Bun__AOT__operationName(size_t index);
extern "C" bool Bun__AOT__isOptionalPass(JSC::AOT::Wire::PassID);
#endif
extern "C" size_t Bun__AOT__describeWhereThisThreadStopped(uint8_t* buffer, size_t capacity);
extern "C" size_t Bun__AOT__describeWhatThreadsAreCompiling(uint8_t* buffer, size_t capacity);

// BunCompilers.cpp
extern "C" bool Bun__AOT__hasCompiler();

// BunAOTHostBindings.cpp, generated
extern "C" void Bun__AOT__registerHostBindings();

// BunAOTRuntime.cpp
#if ENABLE(AOT)
extern "C" JSC::AOT::Wire::ImageVerdict Bun__AOT__useImage(BunAOTBytes image, BunAOTBytes allImages, const BunAOTImageFile* fileOrNull, const uint8_t identity[16]);
extern "C" bool Bun__AOT__admittedCode(BunAOTBytes image, JSC::AOT::Wire::AdmittedCode* admitted);
#endif
extern "C" BunAOTBytes Bun__AOT__imageCode();
extern "C" void Bun__AOT__setMismatchLog(intptr_t descriptor, bool isJSON);
extern "C" void Bun__AOT__setMismatchLogFormat(bool isJSON);
extern "C" void Bun__AOT__setVerbose(bool isVerbose);
extern "C" int64_t Bun__AOT__offsetInCode(const void* address);
extern "C" size_t Bun__AOT__addressOfOffsetInCode(size_t offset);
extern "C" int64_t Bun__AOT__frameAtReturnAddress(const void* returnAddress);
extern "C" size_t Bun__AOT__describeAddresses(const size_t* addresses, size_t count, uint8_t* buffer, size_t capacity);
