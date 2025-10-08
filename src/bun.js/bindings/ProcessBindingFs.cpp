
#include "ProcessBindingFs.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include "ZigGlobalObject.h"

namespace Bun {
using namespace JSC;

static WTF::String makeNotImplementedError(const ASCIILiteral name)
{
    return makeString("process.binding('fs')."_s, name, " is not implemented in Bun. If that breaks something, please file an issue and include a reproducible code sample."_s);
}

#define PROCESS_BINDING_NOT_IMPLEMENTED(str)                                                                                   \
    JSC_DEFINE_HOST_FUNCTION(ProcessBinding_Fs_##str, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame * callFrame)) \
    {                                                                                                                          \
        {                                                                                                                      \
            auto& vm = JSC::getVM(lexicalGlobalObject);                                                                        \
            auto throwScope = DECLARE_THROW_SCOPE(vm);                                                                         \
            auto message = makeNotImplementedError(#str##_s);                                                                  \
            throwScope.throwException(lexicalGlobalObject, createError(lexicalGlobalObject, message));                         \
            return {};                                                                                                         \
        }                                                                                                                      \
    }

PROCESS_BINDING_NOT_IMPLEMENTED(access)

PROCESS_BINDING_NOT_IMPLEMENTED(chmod)

PROCESS_BINDING_NOT_IMPLEMENTED(chown)

PROCESS_BINDING_NOT_IMPLEMENTED(close)

PROCESS_BINDING_NOT_IMPLEMENTED(copyFile)

PROCESS_BINDING_NOT_IMPLEMENTED(cpSyncCheckPaths)

PROCESS_BINDING_NOT_IMPLEMENTED(existsSync)

PROCESS_BINDING_NOT_IMPLEMENTED(fchmod)

PROCESS_BINDING_NOT_IMPLEMENTED(fchown)

PROCESS_BINDING_NOT_IMPLEMENTED(fdatasync)

PROCESS_BINDING_NOT_IMPLEMENTED(fstat)

PROCESS_BINDING_NOT_IMPLEMENTED(fsync)

PROCESS_BINDING_NOT_IMPLEMENTED(ftruncate)

PROCESS_BINDING_NOT_IMPLEMENTED(futimes)

PROCESS_BINDING_NOT_IMPLEMENTED(getFormatOfExtensionlessFile)

PROCESS_BINDING_NOT_IMPLEMENTED(internalModuleStat)

PROCESS_BINDING_NOT_IMPLEMENTED(lchown)

PROCESS_BINDING_NOT_IMPLEMENTED(legacyMainResolve)

PROCESS_BINDING_NOT_IMPLEMENTED(link)

PROCESS_BINDING_NOT_IMPLEMENTED(lstat)

PROCESS_BINDING_NOT_IMPLEMENTED(lutimes)

PROCESS_BINDING_NOT_IMPLEMENTED(mkdir)

PROCESS_BINDING_NOT_IMPLEMENTED(mkdtemp)

PROCESS_BINDING_NOT_IMPLEMENTED(open)

PROCESS_BINDING_NOT_IMPLEMENTED(openFileHandle)

PROCESS_BINDING_NOT_IMPLEMENTED(read)

PROCESS_BINDING_NOT_IMPLEMENTED(readBuffers)

PROCESS_BINDING_NOT_IMPLEMENTED(readdir)

PROCESS_BINDING_NOT_IMPLEMENTED(readFileUtf8)

PROCESS_BINDING_NOT_IMPLEMENTED(readlink)

PROCESS_BINDING_NOT_IMPLEMENTED(realpath)

PROCESS_BINDING_NOT_IMPLEMENTED(rename)

PROCESS_BINDING_NOT_IMPLEMENTED(rmdir)

PROCESS_BINDING_NOT_IMPLEMENTED(rmSync)

PROCESS_BINDING_NOT_IMPLEMENTED(stat)

PROCESS_BINDING_NOT_IMPLEMENTED(statfs)

PROCESS_BINDING_NOT_IMPLEMENTED(StatWatcher)

PROCESS_BINDING_NOT_IMPLEMENTED(symlink)

PROCESS_BINDING_NOT_IMPLEMENTED(unlink)

PROCESS_BINDING_NOT_IMPLEMENTED(utimes)

PROCESS_BINDING_NOT_IMPLEMENTED(writeBuffer)

PROCESS_BINDING_NOT_IMPLEMENTED(writeBuffers)

PROCESS_BINDING_NOT_IMPLEMENTED(writeFileUtf8)

PROCESS_BINDING_NOT_IMPLEMENTED(writeString)

static JSValue ProcessBindingFs_statValues(VM& vm, JSObject* object)
{
    auto* globalObject = object->globalObject();
    return JSC::JSFloat64Array::create(globalObject, globalObject->m_typedArrayFloat64.get(globalObject), 36);
}

static JSValue ProcessBindingFs_bigintStatValues(VM& vm, JSObject* object)
{
    auto* globalObject = object->globalObject();
    return JSC::JSBigInt64Array::create(globalObject, globalObject->m_typedArrayBigInt64.get(globalObject), 36);
}

static JSValue ProcessBindingFs_statFsValues(VM& vm, JSObject* object)
{
    auto* globalObject = object->globalObject();
    return JSC::JSFloat64Array::create(globalObject, globalObject->m_typedArrayFloat64.get(globalObject), 7);
}

static JSValue ProcessBindingFs_bigintStatFsValues(VM& vm, JSObject* object)
{
    auto* globalObject = object->globalObject();
    return JSC::JSBigInt64Array::create(globalObject, globalObject->m_typedArrayBigInt64.get(globalObject), 7);
}

/* Source for ProcessBindingFs.lut.h
@begin processBindingFsTable
    access                          ProcessBinding_Fs_access                        Function 1
    bigintStatFsValues              ProcessBindingFs_bigintStatFsValues             PropertyCallback
    bigintStatValues                ProcessBindingFs_bigintStatValues               PropertyCallback
    chmod                           ProcessBinding_Fs_chmod                         Function 1
    chown                           ProcessBinding_Fs_chown                         Function 1
    close                           ProcessBinding_Fs_close                         Function 1
    copyFile                        ProcessBinding_Fs_copyFile                      Function 1
    cpSyncCheckPaths                ProcessBinding_Fs_cpSyncCheckPaths              Function 1
    existsSync                      ProcessBinding_Fs_existsSync                    Function 1
    fchmod                          ProcessBinding_Fs_fchmod                        Function 1
    fchown                          ProcessBinding_Fs_fchown                        Function 1
    fdatasync                       ProcessBinding_Fs_fdatasync                     Function 1
    fstat                           ProcessBinding_Fs_fstat                         Function 1
    fsync                           ProcessBinding_Fs_fsync                         Function 1
    ftruncate                       ProcessBinding_Fs_ftruncate                     Function 1
    futimes                         ProcessBinding_Fs_futimes                       Function 1
    getFormatOfExtensionlessFile    ProcessBinding_Fs_getFormatOfExtensionlessFile  Function 1
    internalModuleStat              ProcessBinding_Fs_internalModuleStat            Function 1
    kFsStatsFieldsNumber            18                                              ConstantInteger
    lchown                          ProcessBinding_Fs_lchown                        Function 1
    legacyMainResolve               ProcessBinding_Fs_legacyMainResolve             Function 1
    link                            ProcessBinding_Fs_link                          Function 1
    lstat                           ProcessBinding_Fs_lstat                         Function 1
    lutimes                         ProcessBinding_Fs_lutimes                       Function 1
    mkdir                           ProcessBinding_Fs_mkdir                         Function 1
    mkdtemp                         ProcessBinding_Fs_mkdtemp                       Function 1
    open                            ProcessBinding_Fs_open                          Function 1
    openFileHandle                  ProcessBinding_Fs_openFileHandle                Function 1
    read                            ProcessBinding_Fs_read                          Function 1
    readBuffers                     ProcessBinding_Fs_readBuffers                   Function 1
    readdir                         ProcessBinding_Fs_readdir                       Function 1
    readFileUtf8                    ProcessBinding_Fs_readFileUtf8                  Function 1
    readlink                        ProcessBinding_Fs_readlink                      Function 1
    realpath                        ProcessBinding_Fs_realpath                      Function 1
    rename                          ProcessBinding_Fs_rename                        Function 1
    rmdir                           ProcessBinding_Fs_rmdir                         Function 1
    rmSync                          ProcessBinding_Fs_rmSync                        Function 1
    stat                            ProcessBinding_Fs_stat                          Function 1
    statfs                          ProcessBinding_Fs_statfs                        Function 1
    statFsValues                    ProcessBindingFs_statFsValues                   PropertyCallback
    statValues                      ProcessBindingFs_statValues                     PropertyCallback
    StatWatcher                     ProcessBinding_Fs_StatWatcher                   Function 1
    symlink                         ProcessBinding_Fs_symlink                       Function 1
    unlink                          ProcessBinding_Fs_unlink                        Function 1
    utimes                          ProcessBinding_Fs_utimes                        Function 1
    writeBuffer                     ProcessBinding_Fs_writeBuffer                   Function 1
    writeBuffers                    ProcessBinding_Fs_writeBuffers                  Function 1
    writeFileUtf8                   ProcessBinding_Fs_writeFileUtf8                 Function 1
    writeString                     ProcessBinding_Fs_writeString                   Function 1
@end
*/
#include "ProcessBindingFs.lut.h"

const ClassInfo ProcessBindingFs::s_info = { "ProcessBindingFs"_s, &Base::s_info, &processBindingFsTable, nullptr, CREATE_METHOD_TABLE(ProcessBindingFs) };

ProcessBindingFs* ProcessBindingFs::create(VM& vm, Structure* structure)
{
    ProcessBindingFs* obj = new (NotNull, allocateCell<ProcessBindingFs>(vm)) ProcessBindingFs(vm, structure);
    obj->finishCreation(vm);
    return obj;
}

Structure* ProcessBindingFs::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), ProcessBindingFs::info());
}

void ProcessBindingFs::finishCreation(JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

} // namespace Bun
