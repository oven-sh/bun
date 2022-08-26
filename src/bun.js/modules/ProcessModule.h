#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {

inline void generateProcessSourceCode(JSC::JSGlobalObject* lexicalGlobalObject, JSC::Identifier moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) {
    JSC::VM& vm = lexicalGlobalObject->vm();
    GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);

    JSC::JSObject* process = globalObject->processObject();

    auto exportFromProcess = [&] (const String& string) {
        auto identifier = JSC::Identifier::fromString(vm, string);
        exportNames.append(identifier);
        exportValues.append(process->getDirect(vm, identifier));
    };

    exportFromProcess("arch"_s);
    exportFromProcess("argv"_s);
    exportFromProcess("browser"_s);
    exportFromProcess("chdir"_s);
    exportFromProcess("cwd"_s);
    exportFromProcess("dlopen"_s);
    exportFromProcess("exitCode"_s);
    exportFromProcess("exit"_s);
    exportFromProcess("hrtime"_s);
    exportFromProcess("pid"_s);
    exportFromProcess("ppid"_s);
    exportFromProcess("nextTick"_s);
    exportFromProcess("revision"_s);
    exportFromProcess("title"_s);
    exportFromProcess("version"_s);
    exportFromProcess("versions"_s);
    exportFromProcess("platform"_s);

    exportFromProcess("isBun"_s);
}

}
