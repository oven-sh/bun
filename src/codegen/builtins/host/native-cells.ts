export const timerCallbackCell = "Timeout.callback";
export const timerArgumentsCell = "Timeout.arguments";
export const timerFieldsCell = "Timeout.fields";
export const serverOptionsCell = "Server.options";
export const requestHandlerCell = "Server.fetch";
export const socketOptionsCell = "Socket.options";
export const socketsCell = "Socket.instances";
export const socketDataCell = "Socket.data";
export const webSocketsCell = "ServerWebSocket.instances";
export const webSocketDataCell = "ServerWebSocket.data";
export const webSocketHandlerCell = (handler: string) => `ServerWebSocket.${handler}`;
export const responseHandlerCell = (handler: string) => `NodeHTTPResponse.${handler}`;
export const inspectCell = "GlobalObject.utilInspectFunction";
export const stylizeWithColorCell = "GlobalObject.utilInspectStylizeColorFunction";
export const stylizeWithNoColorCell = "GlobalObject.utilInspectStylizeNoColorFunction";
export const inspectOptionsCell = "GlobalObject.utilInspectOptions";
export const nextTickQueueCell = "GlobalObject.nextTickQueue";
export const drainMicrotasksCell = "Process.drainMicrotasks";
export const tickShownToHooksCell = "Process.pushWithInitHooks";
export const onWarningCell = "Process.onWarning";
export const setModuleWrapperCell = "NodeModule.setWrapperItem";
export const writeWarningCell = "Process.writeWarning";
export const standardErrorCell = "Process.stderr";
export const argumentsCell = "Process.argv";
export const runtimeArgumentsCell = "Process.execArgv";
export const closedPromiseOfStreamCell = "WebStream.closedPromise";
export const moduleGraphsCell = "ModuleGraph.graphs";
export const framesOfModuleGraphsCell = "ModuleGraph.frames";
export const asyncContextCell = "GlobalObject.asyncContext";
export const cryptoObjectCell = "GlobalObject.crypto";
export const builtinModulesCell = "NodeModule.builtinModules";
// The warnings that native code emits: the errors that it makes for them, and the errors that process.emitWarning was handed.
export const madeWarningsCell = "Process.madeWarnings";
export const handedWarningsCell = "Process.handedWarnings";
export const emitsWarningCell = "Process.emitsWarning";
export const throwsWarningCell = "Process.throwsWarning";
export const printsErrorWithCodeCell = "ErrorWithCode.toString";
// Functions of native code's own that it queues with process.nextTick.
export const reportsExceptionCell = "EventListener.reportsException";
export const flushesDirectStreamCell = "DirectStreamController.flushesAtEndOfTick";
export const emitsProcessEventCell = "Process.emitsEvent";
// What is stored under a name of a native object, which native code calls for each event.
export const keptHandlerCell = (path: string) => `Handler.${path}`;
// The one object that process.env, Bun.env and import.meta.env answer.
export const environmentCell = "GlobalObject.processEnvironment";
// Ordinary objects that native code fills at the first read of process.versions, process.release and process.features.
export const versionsCell = "Process.versions";
export const releaseCell = "Process.release";
export const featuresCell = "Process.features";
// The blobs over the three standard descriptors, each made at the first read of Bun.stdin, Bun.stdout or Bun.stderr and kept by the realm.
export const standardBlobCell = (name: string) => `GlobalObject.${name}`;
