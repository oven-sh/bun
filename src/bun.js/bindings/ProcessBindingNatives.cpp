// Modelled off of https://github.com/nodejs/node/blob/main/src/node_constants.cc
// Note that if you change any of this code, you probably also have to change NodeConstantsModule.h
#include "ProcessBindingNatives.h"
#include "JavaScriptCore/ObjectConstructor.h"

namespace Bun {
using namespace JSC;

static JSValue processBindingNativesGetter(VM& vm, JSObject* bindingObject)
{
    // Instead of actually returning our source code, we just return a dummy string.
    // Most people just use `process.binding('natives')` to get a list of builtin modules
    // We also don't report internal modules.
    // If any of this breaks your package, please open an issue.
    return jsString(vm, String("/* [native code] */"_s));
}

static JSValue processBindingNativesReturnUndefined(VM& vm, JSObject* bindingObject)
{
    // process.binding('natives').config === undefined
    return jsUndefined();
}

// TODO: generate this table
/* Source for ProcessBindingNatives.lut.h
@begin processBindingNativesTable
    _http_agent              processBindingNativesGetter      PropertyCallback
    _http_client             processBindingNativesGetter      PropertyCallback
    _http_common             processBindingNativesGetter      PropertyCallback
    _http_incoming           processBindingNativesGetter      PropertyCallback
    _http_outgoing           processBindingNativesGetter      PropertyCallback
    _http_server             processBindingNativesGetter      PropertyCallback
    _stream_duplex           processBindingNativesGetter      PropertyCallback
    _stream_passthrough      processBindingNativesGetter      PropertyCallback
    _stream_readable         processBindingNativesGetter      PropertyCallback
    _stream_transform        processBindingNativesGetter      PropertyCallback
    _stream_wrap             processBindingNativesGetter      PropertyCallback
    _stream_writable         processBindingNativesGetter      PropertyCallback
    _tls_common              processBindingNativesGetter      PropertyCallback
    _tls_wrap                processBindingNativesGetter      PropertyCallback
    assert                   processBindingNativesGetter      PropertyCallback
    assert/strict            processBindingNativesGetter      PropertyCallback
    async_hooks              processBindingNativesGetter      PropertyCallback
    buffer                   processBindingNativesGetter      PropertyCallback
    child_process            processBindingNativesGetter      PropertyCallback
    cluster                  processBindingNativesGetter      PropertyCallback
    console                  processBindingNativesGetter      PropertyCallback
    constants                processBindingNativesGetter      PropertyCallback
    crypto                   processBindingNativesGetter      PropertyCallback
    dgram                    processBindingNativesGetter      PropertyCallback
    diagnostics_channel      processBindingNativesGetter      PropertyCallback
    dns                      processBindingNativesGetter      PropertyCallback
    dns/promises             processBindingNativesGetter      PropertyCallback
    domain                   processBindingNativesGetter      PropertyCallback
    events                   processBindingNativesGetter      PropertyCallback
    fs                       processBindingNativesGetter      PropertyCallback
    fs/promises              processBindingNativesGetter      PropertyCallback
    http                     processBindingNativesGetter      PropertyCallback
    http2                    processBindingNativesGetter      PropertyCallback
    https                    processBindingNativesGetter      PropertyCallback
    inspector                processBindingNativesGetter      PropertyCallback
    inspector/promises       processBindingNativesGetter      PropertyCallback
    module                   processBindingNativesGetter      PropertyCallback
    net                      processBindingNativesGetter      PropertyCallback
    os                       processBindingNativesGetter      PropertyCallback
    path                     processBindingNativesGetter      PropertyCallback
    path/posix               processBindingNativesGetter      PropertyCallback
    path/win32               processBindingNativesGetter      PropertyCallback
    perf_hooks               processBindingNativesGetter      PropertyCallback
    process                  processBindingNativesGetter      PropertyCallback
    punycode                 processBindingNativesGetter      PropertyCallback
    querystring              processBindingNativesGetter      PropertyCallback
    readline                 processBindingNativesGetter      PropertyCallback
    readline/promises        processBindingNativesGetter      PropertyCallback
    repl                     processBindingNativesGetter      PropertyCallback
    stream                   processBindingNativesGetter      PropertyCallback
    stream/consumers         processBindingNativesGetter      PropertyCallback
    stream/promises          processBindingNativesGetter      PropertyCallback
    stream/web               processBindingNativesGetter      PropertyCallback
    string_decoder           processBindingNativesGetter      PropertyCallback
    sys                      processBindingNativesGetter      PropertyCallback
    test                     processBindingNativesGetter      PropertyCallback
    test/reporters           processBindingNativesGetter      PropertyCallback
    timers                   processBindingNativesGetter      PropertyCallback
    timers/promises          processBindingNativesGetter      PropertyCallback
    tls                      processBindingNativesGetter      PropertyCallback
    trace_events             processBindingNativesGetter      PropertyCallback
    tty                      processBindingNativesGetter      PropertyCallback
    url                      processBindingNativesGetter      PropertyCallback
    util                     processBindingNativesGetter      PropertyCallback
    util/types               processBindingNativesGetter      PropertyCallback
    v8                       processBindingNativesGetter      PropertyCallback
    vm                       processBindingNativesGetter      PropertyCallback
    wasi                     processBindingNativesGetter      PropertyCallback
    worker_threads           processBindingNativesGetter      PropertyCallback
    zlib                     processBindingNativesGetter      PropertyCallback
    configs                  processBindingNativesReturnUndefined      PropertyCallback
    internal/abort_listener                     processBindingNativesGetter     PropertyCallback
    internal/assert/assertion_error             processBindingNativesGetter     PropertyCallback
    internal/assert/calltracker                 processBindingNativesGetter     PropertyCallback
    internal/assert/myers_diff                  processBindingNativesGetter     PropertyCallback
    internal/assert/utils                       processBindingNativesGetter     PropertyCallback
    internal/buffer                             processBindingNativesGetter     PropertyCallback
    internal/cluster/child                      processBindingNativesGetter     PropertyCallback
    internal/cluster/isPrimary                  processBindingNativesGetter     PropertyCallback
    internal/cluster/primary                    processBindingNativesGetter     PropertyCallback
    internal/cluster/RoundRobinHandle           processBindingNativesGetter     PropertyCallback
    internal/cluster/Worker                     processBindingNativesGetter     PropertyCallback
    internal/crypto/x509                        processBindingNativesGetter     PropertyCallback
    internal/debugger                           processBindingNativesGetter     PropertyCallback
    internal/errors                             processBindingNativesGetter     PropertyCallback
    internal/fifo                               processBindingNativesGetter     PropertyCallback
    internal/fixed_queue                        processBindingNativesGetter     PropertyCallback
    internal/freelist                           processBindingNativesGetter     PropertyCallback
    internal/fs/cp-sync                         processBindingNativesGetter     PropertyCallback
    internal/fs/cp                              processBindingNativesGetter     PropertyCallback
    internal/fs/glob                            processBindingNativesGetter     PropertyCallback
    internal/fs/streams                         processBindingNativesGetter     PropertyCallback
    internal/html                               processBindingNativesGetter     PropertyCallback
    internal/http                               processBindingNativesGetter     PropertyCallback
    internal/http/FakeSocket                    processBindingNativesGetter     PropertyCallback
    internal/linkedlist                         processBindingNativesGetter     PropertyCallback
    internal/perf_hooks/monitorEventLoopDelay   processBindingNativesGetter     PropertyCallback
    internal/primordials.js                     processBindingNativesGetter     PropertyCallback
    internal/promisify                          processBindingNativesGetter     PropertyCallback
    internal/shared                             processBindingNativesGetter     PropertyCallback
    internal/sql/errors                         processBindingNativesGetter     PropertyCallback
    internal/sql/mysql                          processBindingNativesGetter     PropertyCallback
    internal/sql/postgres                       processBindingNativesGetter     PropertyCallback
    internal/sql/query                          processBindingNativesGetter     PropertyCallback
    internal/sql/shared                         processBindingNativesGetter     PropertyCallback
    internal/sql/sqlite                         processBindingNativesGetter     PropertyCallback
    internal/stream.promises                    processBindingNativesGetter     PropertyCallback
    internal/stream                             processBindingNativesGetter     PropertyCallback
    internal/streams/add-abort-signal           processBindingNativesGetter     PropertyCallback
    internal/streams/compose                    processBindingNativesGetter     PropertyCallback
    internal/streams/destroy                    processBindingNativesGetter     PropertyCallback
    internal/streams/duplex                     processBindingNativesGetter     PropertyCallback
    internal/streams/duplexify                  processBindingNativesGetter     PropertyCallback
    internal/streams/duplexpair                 processBindingNativesGetter     PropertyCallback
    internal/streams/end-of-stream              processBindingNativesGetter     PropertyCallback
    internal/streams/from                       processBindingNativesGetter     PropertyCallback
    internal/streams/lazy_transform             processBindingNativesGetter     PropertyCallback
    internal/streams/legacy                     processBindingNativesGetter     PropertyCallback
    internal/streams/native-readable            processBindingNativesGetter     PropertyCallback
    internal/streams/operators                  processBindingNativesGetter     PropertyCallback
    internal/streams/passthrough                processBindingNativesGetter     PropertyCallback
    internal/streams/pipeline                   processBindingNativesGetter     PropertyCallback
    internal/streams/readable                   processBindingNativesGetter     PropertyCallback
    internal/streams/state                      processBindingNativesGetter     PropertyCallback
    internal/streams/transform                  processBindingNativesGetter     PropertyCallback
    internal/streams/utils                      processBindingNativesGetter     PropertyCallback
    internal/streams/writable                   processBindingNativesGetter     PropertyCallback
    internal/timers                             processBindingNativesGetter     PropertyCallback
    internal/tls                                processBindingNativesGetter     PropertyCallback
    internal/tty                                processBindingNativesGetter     PropertyCallback
    internal/url                                processBindingNativesGetter     PropertyCallback
    internal/util/colors                        processBindingNativesGetter     PropertyCallback
    internal/util/deprecate                     processBindingNativesGetter     PropertyCallback
    internal/util/inspect                       processBindingNativesGetter     PropertyCallback
    internal/util/mime                          processBindingNativesGetter     PropertyCallback
    internal/validators                         processBindingNativesGetter     PropertyCallback
    internal/webstreams_adapters                processBindingNativesGetter     PropertyCallback
@end
*/
#include "ProcessBindingNatives.lut.h"

const ClassInfo ProcessBindingNatives::s_info = { "ProcessBindingNatives"_s, &Base::s_info, &processBindingNativesTable, nullptr, CREATE_METHOD_TABLE(ProcessBindingNatives) };

ProcessBindingNatives* ProcessBindingNatives::create(VM& vm, Structure* structure)
{
    ProcessBindingNatives* obj = new (NotNull, allocateCell<ProcessBindingNatives>(vm)) ProcessBindingNatives(vm, structure);
    obj->finishCreation(vm);
    return obj;
}

Structure* ProcessBindingNatives::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), ProcessBindingNatives::info());
}

void ProcessBindingNatives::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

template<typename Visitor>
void ProcessBindingNatives::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ProcessBindingNatives* thisObject = jsCast<ProcessBindingNatives*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(ProcessBindingNatives);

} // namespace Bun
