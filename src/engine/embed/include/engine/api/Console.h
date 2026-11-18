#pragma once

// What the functions of `console` hand on to the embedder.

#include "engine/api/GlobalObject.h"

namespace JSC {

enum class MessageType : uint8_t {
    Log = Engine::MessageType::Log,
    Table = Engine::MessageType::Table,
};

enum class MessageLevel : uint8_t {
    Log = Engine::MessageLevel::Log,
    Warning = Engine::MessageLevel::Warning,
    Error = Engine::MessageLevel::Error,
    Debug = Engine::MessageLevel::Debug,
    Info = Engine::MessageLevel::Info,
};

class ConsoleClient {
public:
    virtual ~ConsoleClient() = default;

    void logWithLevel(JSGlobalObject* globalObject, const ArgList& arguments, MessageLevel level) { messageWithTypeAndLevel(MessageType::Log, level, globalObject, arguments); }

    virtual void messageWithTypeAndLevel(MessageType, MessageLevel, JSGlobalObject*, const ArgList&) = 0;
    virtual void count(JSGlobalObject*, const String& label) = 0;
    virtual void countReset(JSGlobalObject*, const String& label) = 0;
    virtual void profile(JSGlobalObject*, const String& title) = 0;
    virtual void profileEnd(JSGlobalObject*, const String& title) = 0;
    virtual void takeHeapSnapshot(JSGlobalObject*, const String& title) = 0;
    virtual void time(JSGlobalObject*, const String& label) = 0;
    virtual void timeLog(JSGlobalObject*, const String& label, const ArgList&) = 0;
    virtual void timeEnd(JSGlobalObject*, const String& label) = 0;
};

} // namespace JSC

using JSC::MessageLevel;
using JSC::MessageType;
