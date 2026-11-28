import * as b from "../codegen/bindgen-lib.ts";
import * as table from "../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::api" });

const heap = { capability: "heap", throws: true } as const;
const js = { capability: "js", throws: true } as const;
/** For a member that answers any value. The compiler takes it to do anything to its arguments. */
const answersAnything = { returns: b.any, uses: { this: table.retainedByNativeCode }, ...js } as const;
const chainable = { returns: b.self, passThis: true, answersThis: true } as const;

export const TraceState = b.class({
  rustPath: "crate::trace_state::TraceState",
  proto: {
    get: { args: { key: b.string.loose.utf8 }, returns: b.string.utf8.optional },
    set: { args: { key: b.string.loose.utf8, value: b.string.loose.utf8 }, returns: b.self, capability: "heap" },
    unset: { args: { key: b.string.loose.utf8 }, returns: b.self, capability: "heap" },
    serialize: { returns: b.string.utf8 },
  },
});

export const BaggageEntry = b.dictionary({ value: b.string.utf8, metadata: b.string.utf8.optional });
export const BaggageEntryInit = b.dictionary(
  { value: b.string.loose.utf8.owned, metadata: b.string.loose.utf8.owned.nullable },
  { fromJS: true },
);

export const Baggage = b.class({
  rustPath: "crate::baggage::Baggage",
  proto: {
    getEntry: { args: { key: b.string.loose.utf8 }, returns: BaggageEntry.optional },
    getAllEntries: { returns: b.any.returning("Array"), ...heap },
    setEntry: { args: { key: b.string.loose.utf8, entry: BaggageEntryInit }, returns: b.self, capability: "heap" },
    removeEntry: { args: { key: b.string.loose.utf8 }, returns: b.self, capability: "heap" },
    removeEntries: { args: { keys: b.any.variadic }, returns: b.self, ...js },
    clear: { returns: b.self, capability: "heap" },
  },
});

export const SpanContextInit = b.dictionary(
  {
    traceId: b.string.utf8.owned.otherAsNull,
    spanId: b.string.utf8.owned.otherAsNull,
    traceFlags: b.f64.otherAsNull,
    isRemote: b.bool.otherAsNull,
    traceState: b.any,
  },
  { fromJS: true, nonObjectAsEmpty: true, allowArray: true },
);
export const LinkInit = b.dictionary(
  { context: SpanContextInit.nullable, attributes: b.object.otherAsNull },
  { fromJS: true, nonObjectAsEmpty: true, allowArray: true },
);
export const StatusInit = b.dictionary({ code: b.f64.otherAsNull, message: b.any }, { allowArray: true });
export const StatusInput = b.union({ code: b.f64, name: b.string.utf8, status: StatusInit, ignored: b.any });

export const Span = b.class({
  rustPath: "crate::span::Span",
  types: [table.viewType("bun.otel.Span"), table.exactType("$Bindgen.Span")],
  internalFields: ["name", "displaced", "context"],
  proto: {
    setAttribute: { args: { key: b.any, value: b.any }, ...chainable, ...heap },
    setAttributes: { args: { attributes: b.object.otherAsNull }, ...chainable, ...js },
    set: [
      { args: { key: b.string.local, value: b.any }, ...chainable, ...heap, rustName: "set_one" },
      { args: { attributes: b.object.otherAsNull }, ...chainable, ...js, rustName: "set_attributes" },
    ],
    addEvent: { args: { name: b.string.loose.utf8, attributesOrTime: b.any, time: b.any }, ...chainable, ...js },
    addLink: { args: { link: LinkInit }, ...chainable, ...js },
    addLinks: { args: { links: b.jsArray.otherAsNull }, ...chainable, ...js },
    setStatus: { args: { status: StatusInput, message: b.any }, ...chainable, ...js },
    fail: { args: { error: b.any }, ...chainable, ...js },
    ok: chainable,
    updateName: { args: { name: b.any }, ...chainable, ...js },
    recordException: { args: { exception: b.any, time: b.any }, ...chainable, ...js },
    isRecording: { returns: b.bool },
    end: { args: { endTime: b.any.orAbsent }, passThis: true, capability: "heap" },
    spanContext: { returns: b.any.returning("object"), passThis: true, capability: "heap" },
    enter: { ...chainable, capability: "heap" },
    exit: { ...chainable, capability: "heap" },
    "@@dispose": { passThis: true, capability: "heap" },
    traceId: { getter: b.string.local, capability: "heap" },
    spanId: { getter: b.string.local, capability: "heap" },
    parentSpanId: { getter: b.string.local.optional, capability: "heap" },
    traceFlags: { getter: b.u8 },
    isRemote: { getter: b.bool },
    name: { getter: b.any.returning("string"), passThis: true, capability: "heap" },
    kind: { getter: b.u8 },
    ended: { getter: b.bool },
  },
});

export const TelemetryContext = b.class({
  rustPath: "crate::context::Context",
  internalFields: ["span", "nativeSpan", "foreign", "entries"],
  proto: {
    getValue: { args: { key: b.any }, passThis: true, ...answersAnything },
    setValue: { args: { key: b.any, value: b.any }, returns: b.self, passThis: true, ...js },
    deleteValue: { args: { key: b.any }, returns: b.self, passThis: true, ...js },
  },
});

export const SpanKindInput = b.union({ number: b.f64, name: b.string.utf8.owned, ignored: b.any });
export const SpanOptions = b.dictionary(
  {
    root: b.bool.loose.default(false),
    parent: b.any,
    kind: SpanKindInput,
    startTime: b.any,
    attributes: b.object.otherAsNull,
    links: b.jsArray.otherAsNull,
  },
  { fromJS: true, nonObjectAsEmpty: true, allowArray: true },
);

export const Tracer = b.class({
  rustPath: "crate::tracer::Tracer",
  types: [table.viewType("bun.otel.Tracer"), table.exactType("$Bindgen.Tracer")],
  internalFields: ["name", "version"],
  proto: {
    startSpan: { args: { name: b.any, options: b.any, context: b.any }, returns: Span, ...js },
    startActiveSpan: { args: { name: b.any, first: b.any, second: b.any, third: b.any }, ...answersAnything },
    name: { internalField: "name" },
    version: { internalField: "version" },
  },
});

export const BatchOptions = b.dictionary(
  {
    delayMs: { type: b.u32.nullable, altNames: ["scheduledDelayMillis"] },
    timeoutMs: { type: b.u32.nullable, altNames: ["exportTimeoutMillis"] },
    maxQueueSize: b.u32.nullable,
    maxExportBatchSize: b.u32.nullable,
  },
  { reportedAs: "batch" },
);
export const LimitOptions = b.dictionary(
  {
    attributeCountLimit: b.u16.nullable,
    eventCountLimit: b.u16.nullable,
    linkCountLimit: b.u16.nullable,
    attributeValueLengthLimit: b.u32.nullable,
  },
  { reportedAs: "limits" },
);
export const Propagator = b.enumeration(["tracecontext", "baggage"]);
export const ExporterType = b.enumeration(["otlp"]);
export const ExporterCompression = b.enumeration(["none", "gzip"]);
export const ExporterOptions = b.dictionary(
  {
    export: { type: b.callable.nullable, rustName: "export_objects" },
    exportProtobuf: b.callable.nullable,
    exportJSON: { type: b.callable.nullable, rustName: "export_json" },
    type: { type: ExporterType.nullable, rustName: "kind" },
    url: b.string.utf8.owned.nullable,
    headers: b.object.nullable,
    compression: ExporterCompression.nullable,
    timeoutMs: b.u32.nullable,
  },
  { fromJS: true, reportedAs: "exporter" },
);
export const StartOptions = b.dictionary(
  {
    serviceName: b.string.utf8.nullable,
    resourceAttributes: b.object.nullable,
    endpoint: b.string.utf8.nullable,
    headers: b.object.nullable,
    exporters: b.jsArray.nullable,
    sampler: b.any,
    samplerArg: b.any,
    instrumentations: b.object.nullable,
    batch: BatchOptions.nullable,
    captureDbStatement: b.bool.nullable,
    propagators: b.array(Propagator).nullable,
    limits: LimitOptions.nullable,
  },
  { reportedAs: "options" },
);
export const TelemetryStats = b.dictionary({
  spansExported: b.f64,
  spansDropped: b.f64,
  exportsSucceeded: b.f64,
  exportsFailed: b.f64,
  spansPending: b.f64,
  exportsInflight: b.f64,
});

const promise = { returns: b.any.returning("Promise"), ...js } as const;

export const otel = b.namespace(
  {
    start: { args: { options: StartOptions.nullable }, ...js, rustPath: "crate::configure::start" },
    span: { args: { name: b.any, attributesOrCallback: b.any, callback: b.any }, returns: b.any, ...js },
    wrap: { args: { nameOrCallback: b.any, callback: b.any }, returns: b.any, ...js },
    set: [
      { args: { key: b.string.local, value: b.any }, returns: b.bool, ...heap, rustPath: "crate::api::set_one" },
      { args: { attributes: b.object.otherAsNull }, returns: b.bool, ...js, rustPath: "crate::api::set_many" },
    ],
    tracer: { args: { name: b.any, version: b.any }, returns: Tracer, ...js },
    activeSpan: { returns: Span.optional, capability: "heap" },
    with: {
      args: { spanOrContext: b.any, callback: b.callable, thisArg: b.any, args: b.any.variadic },
      returns: b.any,
      ...js,
    },
    forceFlush: promise,
    shutdown: promise,
    stats: { returns: TelemetryStats },
    decode: {
      args: { request: b.bytes({ from: ["buffer"], held: "copied" }) },
      returns: b.any.returning("Array"),
      ...js,
    },
  },
  { finishedBy: { name: "Bun::Telemetry::addValuesOfOtel", header: "TelemetryBindings.h" } },
);

export const TracerProvider = b.class({
  rustPath: "crate::api::TracerProvider",
  proto: {
    getTracer: { args: { name: b.any, version: b.any }, returns: Tracer, ...js },
    forceFlush: promise,
    shutdown: promise,
  },
});

export const ContextToken = b.class({
  rustPath: "crate::api::ContextToken",
  internalFields: ["displaced"],
  proto: {
    dispose: { passThis: true, capability: "heap" },
  },
});

export const ContextManager = b.class({
  rustPath: "crate::api::ContextManager",
  proto: {
    active: { returns: b.any.returning("object"), ...js },
    with: {
      args: { context: b.any, callback: b.callable, thisArg: b.any, args: b.any.variadic },
      ...answersAnything,
    },
    bind: {
      args: { context: b.any, target: b.any },
      ...answersAnything,
      uses: {
        this: table.retainedByNativeCode,
        context: table.retainedByNativeCode,
        target: [table.retained, table.returned, table.storedByKey(table.keysNamed("emit"), table.any)],
      },
    },
    attach: { args: { context: b.any }, returns: ContextToken, ...js },
    enable: chainable,
    disable: { ...chainable, rustName: "enable" },
  },
});

export const TextMapPropagator = b.class({
  rustPath: "crate::api::TextMapPropagator",
  proto: {
    fields: { returns: b.array(b.string.utf8) },
    inject: {
      args: { context: b.any, carrier: b.any, setter: b.any },
      uses: {
        carrier: [
          table.retained,
          table.storedByKey(table.keysNamed("traceparent", "tracestate", "baggage"), table.string),
        ],
      },
      ...js,
    },
    extract: { args: { context: b.any, carrier: b.any, getter: b.any }, ...answersAnything },
  },
});
