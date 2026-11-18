#include "engine/Engine.h"

namespace JSC {

static ArgList argumentList(const EncodedJSValue* first, size_t count)
{
    return { const_cast<EncodedJSValue*>(first), static_cast<unsigned>(count) };
}

extern "C" void engine_host_console_message(JSGlobalObject* globalObject, MessageType type, MessageLevel level, const EncodedJSValue* arguments, size_t count)
{
    globalObject->consoleClient()->messageWithTypeAndLevel(type, level, globalObject, argumentList(arguments, count));
}

extern "C" void engine_host_console_time_log(JSGlobalObject* globalObject, StringImpl* label, const EncodedJSValue* arguments, size_t count)
{
    if (auto* client = globalObject->consoleClient())
        client->timeLog(globalObject, label, argumentList(arguments, count));
}

// Making the text may have run a script.
#define ENGINE_DEFINE_CONSOLE_FUNCTION(name, method)                                           \
    extern "C" void engine_host_console_##name(JSGlobalObject* globalObject, StringImpl* text) \
    {                                                                                          \
        if (auto* client = globalObject->consoleClient())                                      \
            client->method(globalObject, text);                                                \
    }
ENGINE_DEFINE_CONSOLE_FUNCTION(count, count)
ENGINE_DEFINE_CONSOLE_FUNCTION(count_reset, countReset)
ENGINE_DEFINE_CONSOLE_FUNCTION(profile, profile)
ENGINE_DEFINE_CONSOLE_FUNCTION(profile_end, profileEnd)
ENGINE_DEFINE_CONSOLE_FUNCTION(take_heap_snapshot, takeHeapSnapshot)
ENGINE_DEFINE_CONSOLE_FUNCTION(time, time)
ENGINE_DEFINE_CONSOLE_FUNCTION(time_end, timeEnd)

} // namespace JSC
