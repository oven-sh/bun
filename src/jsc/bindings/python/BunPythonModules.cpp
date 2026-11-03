#include "BunPythonModule.h"

#include "BunPython.h"
#include <mutex>

namespace Bun {

using namespace PythonModules;

extern "C" uint8_t Bun__Python__disableAutoInstall(JSC::JSGlobalObject*);
extern "C" void Bun__Python__restoreAutoInstall(JSC::JSGlobalObject*, uint8_t previous);

// _bun_resolver.without_installing(function, *args): function(*args), while Bun's resolver looks no further than the disk.
static JSValue withoutInstalling(JSGlobalObject* globalObject, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!args.size() || args.hasKeywords())
        return raiseTypeError(globalObject, scope, "without_installing() takes a function and its positional arguments"_s);
    uint8_t previous = Bun__Python__disableAutoInstall(globalObject);
    JSValue result = call(globalObject, args[0], CallArgs(args.positional().subspan(1)));
    Bun__Python__restoreAutoInstall(globalObject, previous);
    RETURN_IF_EXCEPTION(scope, { });
    return result;
}

static constexpr NativeDef resolverFunctions[] = {
    PY_FUNCTION("without_installing", withoutInstalling, "(function, /, *args)"),
};

static void initializeBunResolverModule(JSGlobalObject* globalObject, PyModule* module)
{
    module->addFunctions(globalObject, resolverFunctions);
}

static constexpr JSC::Python::NativeModuleDef pythonModules[] = {
    { "_blake2"_s, initializeBlake2Module },
    { "_bun_loop"_s, initializeBunLoopModule },
    { "_bun_resolver"_s, initializeBunResolverModule },
    { "_bz2"_s, initializeBz2Module },
    { "_hashlib"_s, initializeHashlibModule },
    { "_hmac"_s, initializeHmacModule },
    { "_lzma"_s, initializeLzmaModule },
    { "_md5"_s, initializeMD5Module },
    { "_sha1"_s, initializeSHA1Module },
    { "_sha2"_s, initializeSHA2Module },
    { "_sha3"_s, initializeSHA3Module },
    { "_sqlite3"_s, initializeSqlite3Module },
#if !OS(WINDOWS)
    { "_ssl"_s, initializeSslModule },
#endif
    { "_zstd"_s, initializeZstdModule },
    { "zlib"_s, initializeZlibModule },
};

namespace PythonModules {

bool takesNoArguments(JSGlobalObject* globalObject, ASCIILiteral function, const CallArgs& args)
{
    if (!args.totalCount())
        return true;
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    raiseTypeError(globalObject, scope, function, "() takes no arguments"_s);
    return false;
}

bool unpackArguments(JSGlobalObject* globalObject, const Parameters& parameters, const CallArgs& args, JSValue* values)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    unsigned count = parameters.count();
    unsigned given = args.size();
    unsigned keywordCount = args.keywordCount();
    ASCIILiteral name = parameters.function;
    auto plural = [](unsigned n) { return n == 1 ? ""_s : "s"_s; };

    if (given + keywordCount > count) {
        raiseTypeError(globalObject, scope, name, "() takes at most "_s, count, ' ', given ? ""_s : "keyword "_s, "argument"_s, plural(count), " ("_s, given + keywordCount, " given)"_s);
        return false;
    }
    if (given > parameters.maxPositional) {
        if (!parameters.maxPositional)
            raiseTypeError(globalObject, scope, name, "() takes no positional arguments"_s);
        else
            raiseTypeError(globalObject, scope, name, "() takes "_s, parameters.required < parameters.maxPositional ? "at most"_s : "exactly"_s, ' ', parameters.maxPositional, " positional argument"_s, plural(parameters.maxPositional), " ("_s, given, " given)"_s);
        return false;
    }
    unsigned requiredPositionalOnly = std::min(parameters.positionalOnly, parameters.required);
    if (given < requiredPositionalOnly) {
        raiseTypeError(globalObject, scope, name, "() takes "_s, requiredPositionalOnly < parameters.maxPositional ? "at least"_s : "exactly"_s, ' ', requiredPositionalOnly, " positional argument"_s, plural(requiredPositionalOnly), " ("_s, given, " given)"_s);
        return false;
    }

    for (unsigned i = 0; i < count; ++i)
        values[i] = i < given ? args[i] : JSValue();
    unsigned matched = 0;
    for (unsigned i = std::max(given, parameters.positionalOnly); i < count; ++i) {
        if (keywordCount)
            values[i] = args.keyword(parameters.names[i - parameters.positionalOnly]);
        if (values[i])
            ++matched;
        else if (i < parameters.required) {
            raiseTypeError(globalObject, scope, name, "() missing required argument '"_s, parameters.names[i - parameters.positionalOnly], "' (pos "_s, i + 1, ')');
            return false;
        }
    }
    if (matched == keywordCount)
        return true;

    // One of the keywords is a parameter given by position as well, or no parameter at all.
    for (unsigned k = 0; k < keywordCount; ++k) {
        String keyword = args.keywordName(k)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        bool isParameter = false;
        for (unsigned i = parameters.positionalOnly; i < count; ++i) {
            if (keyword != parameters.names[i - parameters.positionalOnly])
                continue;
            isParameter = true;
            if (i < given) {
                raiseTypeError(globalObject, scope, "argument for "_s, name, "() given by name ('"_s, keyword, "') and position ("_s, i + 1, ')');
                return false;
            }
        }
        if (!isParameter) {
            raiseTypeError(globalObject, scope, name, "() got an unexpected keyword argument '"_s, keyword, '\'');
            return false;
        }
    }
    return true;
}

} // namespace PythonModules

void registerPythonModules()
{
    static std::once_flag once;
    std::call_once(once, [] {
        JSC::Python::setHostNativeModules(pythonModules);
        installPythonEventLoop();
    });
}

} // namespace Bun
