#include "wtf-bindings.h"

#include "wtf/StackTrace.h"
#include "wtf/dtoa.h"

extern "C" double WTF__parseDouble(const LChar* string, size_t length, size_t* position)
{
    return WTF::parseDouble(string, length, *position);
}

extern "C" void WTF__copyLCharsFromUCharSource(LChar* destination, const UChar* source, size_t length)
{
    WTF::StringImpl::copyCharacters(destination, source, length);
}

extern "C" void Bun__crashReportWrite(void* ctx, const char* message, size_t length);
extern "C" void Bun__crashReportDumpStackTrace(void* ctx)
{
    static constexpr int framesToShow = 32;
    static constexpr int framesToSkip = 2;
    void* stack[framesToShow + framesToSkip];
    int frames = framesToShow + framesToSkip;
    WTFGetBacktrace(stack, &frames);
    int size = frames - framesToSkip;
    bool isFirst = true;
    for (int frameNumber = 0; frameNumber < size; ++frameNumber) {
        auto demangled = WTF::StackTraceSymbolResolver::demangle(stack[frameNumber]);

        StringPrintStream out;
        if (isFirst) {
            isFirst = false;
            if (demangled)
                out.printf("\n%-3d %p %s", frameNumber, stack[frameNumber], demangled->demangledName() ? demangled->demangledName() : demangled->mangledName());
            else
                out.printf("\n%-3d %p", frameNumber, stack[frameNumber]);
        } else {
            if (demangled)
                out.printf("%-3d ??? %s", frameNumber, demangled->demangledName() ? demangled->demangledName() : demangled->mangledName());
            else
                out.printf("%-3d ???", frameNumber);
        }

        auto str = out.toCString();
        Bun__crashReportWrite(ctx, str.data(), str.length());
    }
}

// For whatever reason
// Doing this in C++/C is 2x faster than doing it in Zig.
// However, it's still slower than it should be.
static constexpr size_t encodeMapSize = 64;
static constexpr char base64URLEncMap[encodeMapSize] = {
    0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x4B,
    0x4C, 0x4D, 0x4E, 0x4F, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56,
    0x57, 0x58, 0x59, 0x5A, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67,
    0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F, 0x70, 0x71, 0x72,
    0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x30, 0x31, 0x32,
    0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x2D, 0x5F
};

extern "C" size_t WTF__base64URLEncode(const unsigned char* __restrict inputDataBuffer, size_t inputDataBufferSize,
    unsigned char* __restrict destinationDataBuffer,
    size_t destinationDataBufferSize)
{
    size_t sidx = 0;
    size_t didx = 0;

    if (inputDataBufferSize > 1) {
        while (sidx < inputDataBufferSize - 2) {
            destinationDataBuffer[didx++] = base64URLEncMap[(inputDataBuffer[sidx] >> 2) & 077];
            destinationDataBuffer[didx++] = base64URLEncMap[((inputDataBuffer[sidx + 1] >> 4) & 017) | ((inputDataBuffer[sidx] << 4) & 077)];
            destinationDataBuffer[didx++] = base64URLEncMap[((inputDataBuffer[sidx + 2] >> 6) & 003) | ((inputDataBuffer[sidx + 1] << 2) & 077)];
            destinationDataBuffer[didx++] = base64URLEncMap[inputDataBuffer[sidx + 2] & 077];
            sidx += 3;
        }
    }

    if (sidx < inputDataBufferSize) {
        destinationDataBuffer[didx++] = base64URLEncMap[(inputDataBuffer[sidx] >> 2) & 077];
        if (sidx < inputDataBufferSize - 1) {
            destinationDataBuffer[didx++] = base64URLEncMap[((inputDataBuffer[sidx + 1] >> 4) & 017) | ((inputDataBuffer[sidx] << 4) & 077)];
            destinationDataBuffer[didx++] = base64URLEncMap[(inputDataBuffer[sidx + 1] << 2) & 077];
        } else
            destinationDataBuffer[didx++] = base64URLEncMap[(inputDataBuffer[sidx] << 4) & 077];
    }

    while (didx < destinationDataBufferSize)
        destinationDataBuffer[didx++] = '=';

    return destinationDataBufferSize;
}