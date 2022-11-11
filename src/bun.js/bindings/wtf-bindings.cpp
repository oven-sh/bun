#include "wtf-bindings.h"
#include "wtf/text/Base64.h"

#include "wtf/StackTrace.h"

extern "C" void WTF__copyLCharsFromUCharSource(LChar* destination, const UChar* source, size_t length)
{
    WTF::StringImpl::copyCharacters(destination, source, length);
}

extern "C" JSC::EncodedJSValue WTF__toBase64URLStringValue(const uint8_t* bytes, size_t length, JSC::JSGlobalObject* globalObject)
{
    WTF::String string = WTF::base64URLEncodeToString(reinterpret_cast<const LChar*>(bytes), static_cast<unsigned int>(length));
    string.impl()->ref();
    return JSC::JSValue::encode(JSC::jsString(globalObject->vm(), string));
}

extern "C" void Bun__crashReportWrite(void* ctx, const char* message, size_t length);
extern "C" void Bun__crashReportDumpStackTrace(void* ctx)
{
    static constexpr int framesToShow = 32;
    static constexpr int framesToSkip = 2;
    void* stack[framesToShow + framesToSkip];
    int frames = framesToShow + framesToSkip;
    WTFGetBacktrace(stack, &frames);
    bool isFirst = true;
    WTF::StackTraceSymbolResolver { { stack, static_cast<size_t>(frames) } }.forEach([&](int frameNumber, void* stackFrame, const char* name) {
        if (frameNumber < framesToSkip)
            return;

        StringPrintStream out;
        if (isFirst) {
            isFirst = false;
            if (name)
                out.printf("\n%-3d %p %s", frameNumber, stackFrame, name);
            else
                out.printf("\n%-3d %p", frameNumber, stackFrame);
        } else {
            if (name)
                out.printf("%-3d %p %s", frameNumber, stackFrame, name);
            else
                out.printf("%-3d %p", frameNumber, stackFrame);
        }

        auto str = out.toCString();
        Bun__crashReportWrite(ctx, str.data(), str.length());
    });
}