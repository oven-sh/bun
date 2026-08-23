//! Link-time references to the C/C++ symbols a native addon resolves against
//! the Bun binary (the C++ half of Node-API, the `v8::` shim, the `uv_*`
//! polyfills), so the linker keeps them. Only their addresses are taken
//! ([`keep`]); the declarations carry no signature and are never called.

use bun_core::keep_symbols;

// Node-API functions implemented in C++ (napi.cpp).
unsafe extern "C" {
    pub(super) fn napi_add_async_cleanup_hook();
    pub(super) fn napi_add_env_cleanup_hook();
    pub(super) fn napi_add_finalizer();
    pub(super) fn napi_adjust_external_memory();
    pub(super) fn napi_call_function();
    pub(super) fn napi_check_object_type_tag();
    pub(super) fn napi_coerce_to_bool();
    pub(super) fn napi_coerce_to_number();
    pub(super) fn napi_coerce_to_object();
    pub(super) fn napi_create_arraybuffer();
    pub(super) fn napi_create_bigint_int64();
    pub(super) fn napi_create_bigint_uint64();
    pub(super) fn napi_create_bigint_words();
    pub(super) fn napi_create_buffer();
    pub(super) fn napi_create_buffer_copy();
    pub(super) fn napi_create_dataview();
    pub(super) fn napi_create_double();
    pub(super) fn napi_create_error();
    pub(super) fn napi_create_external();
    pub(super) fn napi_create_external_arraybuffer();
    pub(super) fn napi_create_external_buffer();
    pub(super) fn napi_create_object();
    pub(super) fn napi_create_range_error();
    pub(super) fn napi_create_reference();
    pub(super) fn napi_create_symbol();
    pub(super) fn napi_create_type_error();
    pub(super) fn napi_create_typedarray();
    pub(super) fn napi_define_class();
    pub(super) fn napi_define_properties();
    pub(super) fn napi_delete_element();
    pub(super) fn napi_delete_reference();
    pub(super) fn napi_detach_arraybuffer();
    pub(super) fn napi_fatal_exception();
    pub(super) fn napi_get_all_property_names();
    pub(super) fn napi_get_and_clear_last_exception();
    pub(super) fn napi_get_cb_info();
    pub(super) fn napi_get_date_value();
    pub(super) fn napi_get_element();
    pub(super) fn napi_get_global();
    pub(super) fn napi_get_instance_data();
    pub(super) fn napi_get_last_error_info();
    pub(super) fn napi_get_new_target();
    pub(super) fn napi_get_reference_value();
    pub(super) fn napi_get_value_bigint_int64();
    pub(super) fn napi_get_value_bigint_uint64();
    pub(super) fn napi_get_value_bigint_words();
    pub(super) fn napi_get_value_bool();
    pub(super) fn napi_get_value_double();
    pub(super) fn napi_get_value_external();
    pub(super) fn napi_get_value_int32();
    pub(super) fn napi_get_value_int64();
    pub(super) fn napi_get_value_string_latin1();
    pub(super) fn napi_get_value_string_utf16();
    pub(super) fn napi_get_value_string_utf8();
    pub(super) fn napi_get_value_uint32();
    pub(super) fn napi_has_element();
    pub(super) fn napi_instanceof();
    pub(super) fn napi_is_buffer();
    pub(super) fn napi_is_detached_arraybuffer();
    pub(super) fn napi_is_exception_pending();
    pub(super) fn napi_is_typedarray();
    pub(super) fn napi_new_instance();
    pub(super) fn napi_reference_ref();
    pub(super) fn napi_reference_unref();
    pub(super) fn napi_remove_async_cleanup_hook();
    pub(super) fn napi_remove_env_cleanup_hook();
    pub(super) fn napi_remove_wrap();
    pub(super) fn napi_run_script();
    pub(super) fn napi_set_element();
    pub(super) fn napi_set_instance_data();
    pub(super) fn napi_throw();
    pub(super) fn napi_throw_error();
    pub(super) fn napi_throw_range_error();
    pub(super) fn napi_throw_type_error();
    pub(super) fn napi_type_tag_object();
    pub(super) fn napi_typeof();
    pub(super) fn napi_unwrap();
    pub(super) fn napi_wrap();
    pub(super) fn node_api_create_syntax_error();
    pub(super) fn node_api_symbol_for();
    pub(super) fn node_api_throw_syntax_error();
    pub(super) fn node_api_create_external_string_latin1();
    pub(super) fn node_api_create_external_string_utf16();
    pub(super) fn node_api_set_prototype();
    pub(super) fn node_api_create_object_with_properties();
    pub(super) fn node_api_create_sharedarraybuffer();
    pub(super) fn node_api_create_external_sharedarraybuffer();
    pub(super) fn node_api_is_sharedarraybuffer();
}
// v8:: C++ symbols defined in v8.cpp.
// TODO: write a script to generate this list. ideally it wouldn't even need to be committed to source.
#[cfg(not(windows))]
mod v8_api {
    unsafe extern "C" {
        pub(super) fn _ZN2v87Isolate10GetCurrentEv();
        pub(super) fn _ZN2v87Isolate13TryGetCurrentEv();
        pub(super) fn _ZN2v87Isolate17GetCurrentContextEv();
        pub(super) fn _ZN2v87Isolate28GetEnteredOrMicrotaskContextEv();
        pub(super) fn _ZN2v87Isolate36GetContinuationPreservedEmbedderDataEv();
        pub(super) fn _ZN2v87Isolate7IsInUseEv();
        pub(super) fn _ZN2v87Isolate21LowMemoryNotificationEv();
        pub(super) fn _ZN2v87Isolate36AutomaticallyRestoreInitialHeapLimitEd();
        pub(super) fn _ZN2v87Isolate30NumberOfTrackedHeapObjectTypesEv();
        pub(super) fn _ZN2v87Isolate31GetHeapObjectStatisticsAtLastGCEPNS_20HeapObjectStatisticsEm();
        pub(super) fn _ZN2v87Isolate21AddGCPrologueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_S2_()
        ;
        pub(super) fn _ZN2v87Isolate24RemoveGCPrologueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_()
        ;
        pub(super) fn _ZN2v87Isolate21AddGCEpilogueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_S2_()
        ;
        pub(super) fn _ZN2v87Isolate24RemoveGCEpilogueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_()
        ;
        pub(super) fn _ZN2v87Isolate24AddNearHeapLimitCallbackEPFmPvmmES1_();
        pub(super) fn _ZN2v87Isolate27RemoveNearHeapLimitCallbackEPFmPvmmEm();
        pub(super) fn _ZN2v87Isolate16RequestInterruptEPFvPS0_PvES2_();
        pub(super) fn _ZN2v87Isolate14ThrowExceptionENS_5LocalINS_5ValueEEE();
        pub(super) fn _ZN2v87Isolate10ThrowErrorENS_5LocalINS_6StringEEE();
        pub(super) fn _ZN2v89Exception5ErrorENS_5LocalINS_6StringEEENS1_INS_5ValueEEE();
        pub(super) fn _ZN2v89Exception9TypeErrorENS_5LocalINS_6StringEEENS1_INS_5ValueEEE();
        pub(super) fn _ZN2v87Isolate15GetHeapProfilerEv();
        pub(super) fn _ZN2v812HeapProfiler24StopSamplingHeapProfilerEv();
        pub(super) fn _ZN2v812HeapProfiler20GetAllocationProfileEv();
        pub(super) fn _ZN4node25AddEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_();
        pub(super) fn _ZN4node28RemoveEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_();
        pub(super) fn _ZN4node19GetCurrentEventLoopEPN2v87IsolateE();
        pub(super) fn _ZN4node29AsyncHooksGetExecutionAsyncIdEN2v85LocalINS0_7ContextEEE();
        pub(super) fn _ZN4node13EmitAsyncInitEPN2v87IsolateENS0_5LocalINS0_6ObjectEEENS3_INS0_6StringEEEd()
        ;
        pub(super) fn _ZN4node16EmitAsyncDestroyEPN2v87IsolateENS_13async_contextE();
        pub(super) fn _ZN4node12MakeCallbackEPN2v87IsolateENS0_5LocalINS0_6ObjectEEENS3_INS0_8FunctionEEEiPNS3_INS0_5ValueEEENS_13async_contextE()
        ;
        pub(super) fn _ZN2v84base9TimeTicks3NowEv();
        pub(super) fn _ZN2v86Number3NewEPNS_7IsolateEd();
        pub(super) fn _ZNK2v86Number5ValueEv();
        pub(super) fn _ZN2v86Number12NewFromInt32EPNS_7IsolateEi();
        pub(super) fn _ZN2v86Number13NewFromUint32EPNS_7IsolateEj();
        pub(super) fn _ZN2v86String11NewFromUtf8EPNS_7IsolateEPKcNS_13NewStringTypeEi();
        pub(super) fn _ZNK2v86String9WriteUtf8EPNS_7IsolateEPciPii();
        pub(super) fn _ZN2v812api_internal12ToLocalEmptyEv();
        pub(super) fn _ZNK2v86String6LengthEv();
        pub(super) fn _ZN2v88External3NewEPNS_7IsolateEPv();
        pub(super) fn _ZNK2v88External5ValueEv();
        pub(super) fn _ZN2v88External3NewEPNS_7IsolateEPvt();
        pub(super) fn _ZNK2v88External5ValueEt();
        pub(super) fn _ZN2v86Object3NewEPNS_7IsolateE();
        pub(super) fn _ZN2v86Object3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_();
        pub(super) fn _ZN2v86Object3SetENS_5LocalINS_7ContextEEEjNS1_INS_5ValueEEE();
        pub(super) fn _ZN2v86Object16SetInternalFieldEiNS_5LocalINS_4DataEEE();
        pub(super) fn _ZN2v86Object20SlowGetInternalFieldEi();
        pub(super) fn _ZN2v86Object32SetAlignedPointerInInternalFieldEiPvt();
        pub(super) fn _ZN2v86Object38SlowGetAlignedPointerFromInternalFieldEit();
        pub(super) fn _ZN2v86Object3GetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEE();
        pub(super) fn _ZN2v86Object3GetENS_5LocalINS_7ContextEEEj();
        pub(super) fn _ZN2v811HandleScope12CreateHandleEPNS_8internal7IsolateEm();
        pub(super) fn _ZN2v811HandleScope12CreateHandleEPNS_7IsolateEm();
        pub(super) fn _ZN2v811HandleScope10InitializeEPNS_7IsolateE();
        pub(super) fn _ZNK2v85Value16QuickIsUndefinedEv();
        pub(super) fn _ZNK2v85Value11QuickIsNullEv();
        pub(super) fn _ZNK2v85Value22QuickIsNullOrUndefinedEv();
        pub(super) fn _ZNK2v85Value13QuickIsStringEv();
        pub(super) fn _ZN2v811HandleScope6ExtendEPNS_7IsolateE();
        pub(super) fn _ZN2v811HandleScope16DeleteExtensionsEPNS_7IsolateE();
        pub(super) fn _ZN2v811HandleScopeC1EPNS_7IsolateE();
        pub(super) fn _ZN2v811HandleScopeD1Ev();
        pub(super) fn _ZN2v811HandleScopeD2Ev();
        pub(super) fn _ZN2v816FunctionTemplate11GetFunctionENS_5LocalINS_7ContextEEE();
        pub(super) fn _ZN2v816FunctionTemplate12SetClassNameENS_5LocalINS_6StringEEE();
        pub(super) fn _ZN2v816FunctionTemplate3NewEPNS_7IsolateEPFvRKNS_20FunctionCallbackInfoINS_5ValueEEEENS_5LocalIS4_EENSA_INS_9SignatureEEEiNS_19ConstructorBehaviorENS_14SideEffectTypeEPKNS_9CFunctionEttt()
        ;
        pub(super) fn _ZN2v814ObjectTemplate11NewInstanceENS_5LocalINS_7ContextEEE();
        pub(super) fn _ZN2v814ObjectTemplate21SetInternalFieldCountEi();
        pub(super) fn _ZNK2v814ObjectTemplate18InternalFieldCountEv();
        pub(super) fn _ZN2v814ObjectTemplate3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE();
        pub(super) fn _ZN2v816FunctionTemplate16InstanceTemplateEv();
        pub(super) fn _ZN2v816FunctionTemplate17PrototypeTemplateEv();
        pub(super) fn _ZN2v88Template3SetENS_5LocalINS_4NameEEENS1_INS_4DataEEENS_17PropertyAttributeE()
        ;
        pub(super) fn _ZN2v88Template21SetNativeDataPropertyENS_5LocalINS_4NameEEEPFvS3_RKNS_20PropertyCallbackInfoINS_5ValueEEEEPFvS3_NS1_IS5_EERKNS4_IvEEESB_NS_17PropertyAttributeENS_14SideEffectTypeESI_()
        ;
        pub(super) fn _ZN2v89Signature3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE();
        pub(super) fn _ZN2v824EscapableHandleScopeBase10EscapeSlotEPm();
        pub(super) fn _ZN2v824EscapableHandleScopeBaseC2EPNS_7IsolateE();
        pub(super) fn _ZN2v88internal35IsolateFromNeverReadOnlySpaceObjectEm();
        pub(super) fn _ZN2v85Array3NewEPNS_7IsolateEPNS_5LocalINS_5ValueEEEm();
        pub(super) fn _ZNK2v85Array6LengthEv();
        pub(super) fn _ZN2v85Array3NewEPNS_7IsolateEi();
        pub(super) fn _ZN2v85Array7IterateENS_5LocalINS_7ContextEEEPFNS0_14CallbackResultEjNS1_INS_5ValueEEEPvES7_()
        ;
        pub(super) fn _ZN2v85Array9CheckCastEPNS_5ValueE();
        pub(super) fn _ZN2v88Function7SetNameENS_5LocalINS_6StringEEE();
        pub(super) fn _ZN2v88Function4CallENS_5LocalINS_7ContextEEENS1_INS_5ValueEEEiPS5_();
        pub(super) fn _ZNK2v88Function11NewInstanceENS_5LocalINS_7ContextEEEiPNS1_INS_5ValueEEE();
        pub(super) fn _ZNK2v85Value9IsBooleanEv();
        pub(super) fn _ZNK2v87Boolean5ValueEv();
        pub(super) fn _ZNK2v85Value10FullIsTrueEv();
        pub(super) fn _ZNK2v85Value11FullIsFalseEv();
        pub(super) fn _ZN2v820EscapableHandleScopeC1EPNS_7IsolateE();
        pub(super) fn _ZN2v820EscapableHandleScopeC2EPNS_7IsolateE();
        pub(super) fn _ZN2v820EscapableHandleScopeD1Ev();
        pub(super) fn _ZN2v820EscapableHandleScopeD2Ev();
        pub(super) fn _ZNK2v85Value8IsObjectEv();
        pub(super) fn _ZNK2v85Value8IsNumberEv();
        pub(super) fn _ZNK2v85Value8IsUint32Ev();
        pub(super) fn _ZNK2v85Value11Uint32ValueENS_5LocalINS_7ContextEEE();
        pub(super) fn _ZNK2v85Value11IsUndefinedEv();
        pub(super) fn _ZNK2v85Value6IsNullEv();
        pub(super) fn _ZNK2v85Value17IsNullOrUndefinedEv();
        pub(super) fn _ZNK2v85Value6IsTrueEv();
        pub(super) fn _ZNK2v85Value7IsFalseEv();
        pub(super) fn _ZNK2v85Value8IsStringEv();
        pub(super) fn _ZNK2v85Value12StrictEqualsENS_5LocalIS0_EE();
        pub(super) fn _ZN2v87Boolean3NewEPNS_7IsolateEb();
        pub(super) fn _ZN2v811ArrayBuffer3NewEPNS_7IsolateEmNS_30BackingStoreInitializationModeE();
        pub(super) fn _ZN2v811ArrayBuffer15GetBackingStoreEv();
        pub(super) fn _ZNK2v812BackingStore4DataEv();
        pub(super) fn _ZN2v815ArrayBufferView6BufferEv();
        pub(super) fn _ZN2v815ArrayBufferView10ByteLengthEv();
        pub(super) fn _ZN2v815ArrayBufferView10ByteOffsetEv();
        pub(super) fn _ZN2v810Uint8Array3NewENS_5LocalINS_11ArrayBufferEEEmm();
        pub(super) fn _ZN2v811Uint32Array3NewENS_5LocalINS_11ArrayBufferEEEmm();
        pub(super) fn _ZN2v86Object16GetInternalFieldEi();
        pub(super) fn _ZN2v87Context10GetIsolateEv();
        pub(super) fn _ZN2v86String14NewFromOneByteEPNS_7IsolateEPKhNS_13NewStringTypeEi();
        pub(super) fn _ZNK2v86String10Utf8LengthEPNS_7IsolateE();
        pub(super) fn _ZNK2v86String10IsExternalEv();
        pub(super) fn _ZNK2v86String17IsExternalOneByteEv();
        pub(super) fn _ZNK2v86String17IsExternalTwoByteEv();
        pub(super) fn _ZNK2v86String9IsOneByteEv();
        pub(super) fn _ZNK2v86String19ContainsOnlyOneByteEv();
        pub(super) fn _ZNK2v86String7WriteV2EPNS_7IsolateEjjPti();
        pub(super) fn _ZNK2v86String14WriteOneByteV2EPNS_7IsolateEjjPhi();
        pub(super) fn _ZNK2v86String11WriteUtf8V2EPNS_7IsolateEPcmiPm();
        pub(super) fn _ZNK2v86String12Utf8LengthV2EPNS_7IsolateE();
        pub(super) fn _ZN2v812api_internal18GlobalizeReferenceEPNS_8internal7IsolateEm();
        pub(super) fn _ZN2v812api_internal13DisposeGlobalEPm();
        pub(super) fn _ZN2v812api_internal8MakeWeakEPmPvPFvRKNS_16WeakCallbackInfoIvEEENS_16WeakCallbackTypeE()
        ;
        pub(super) fn _ZN2v812api_internal9ClearWeakEPm();
        pub(super) fn _ZN2v812api_internal19MoveGlobalReferenceEPPmS2_();
        pub(super) fn _ZN2v812api_internal23GetFunctionTemplateDataEPNS_7IsolateENS_5LocalINS_4DataEEE()
        ;
        pub(super) fn _ZNK2v88Function7GetNameEv();
        pub(super) fn _ZNK2v85Value10IsFunctionEv();
        pub(super) fn _ZNK2v85Value5IsMapEv();
        pub(super) fn _ZNK2v85Value7IsArrayEv();
        pub(super) fn _ZNK2v85Value7IsInt32Ev();
        pub(super) fn _ZNK2v85Value8IsBigIntEv();
        pub(super) fn _ZN2v812api_internal17FromJustIsNothingEv();
        pub(super) fn _ZN2v87Integer3NewEPNS_7IsolateEi();
        pub(super) fn _ZN2v87Integer15NewFromUnsignedEPNS_7IsolateEj();
        pub(super) fn _ZNK2v87Integer5ValueEv();
        pub(super) fn _ZN2v86String18NewFromUtf8LiteralEPNS_7IsolateEPKcNS_13NewStringTypeEi();
        pub(super) fn _ZNK2v85Value12IsUint8ArrayEv();
        pub(super) fn _ZNK2v85Value8ToStringENS_5LocalINS_7ContextEEE();
        pub(super) fn _ZNK2v85Value9ToIntegerENS_5LocalINS_7ContextEEE();
        pub(super) fn _ZN2v87Context6GlobalEv();
        pub(super) fn _ZNK2v86Object18InternalFieldCountEv();
        pub(super) fn _ZN2v86Object15GetIdentityHashEv();
        pub(super) fn _ZN2v86Object17DefineOwnPropertyENS_5LocalINS_7ContextEEENS1_INS_4NameEEENS1_INS_5ValueEEENS_17PropertyAttributeE()
        ;
        pub(super) fn _ZN2v820ToExternalPointerTagEt();
        pub(super) fn _ZN2v88internal9Internals17GetCurrentIsolateEv();
        pub(super) fn _ZN2v820HeapObjectStatisticsC1Ev();
        pub(super) fn _ZN2v811CpuProfiler3NewEPNS_7IsolateENS_22CpuProfilingNamingModeENS_23CpuProfilingLoggingModeE()
        ;
        pub(super) fn _ZN2v811CpuProfiler7DisposeEv();
        pub(super) fn _ZN2v811CpuProfiler19SetSamplingIntervalEi();
        pub(super) fn _ZN2v811CpuProfiler5StartENS_5LocalINS_6StringEEENS_16CpuProfilingModeEbj();
        pub(super) fn _ZN2v811CpuProfiler4StopEj();
        pub(super) fn _ZN2v811CpuProfiler14StartProfilingENS_5LocalINS_6StringEEENS_16CpuProfilingModeEbj()
        ;
        pub(super) fn _ZN2v811CpuProfiler14StartProfilingENS_5LocalINS_6StringEEEb();
        pub(super) fn _ZN2v811CpuProfiler13StopProfilingENS_5LocalINS_6StringEEE();
        pub(super) fn _ZN2v810CpuProfile6DeleteEv();
        pub(super) fn _ZNK2v810CpuProfile8GetTitleEv();
        pub(super) fn _ZNK2v810CpuProfile10GetEndTimeEv();
        pub(super) fn _ZNK2v810CpuProfile12GetStartTimeEv();
        pub(super) fn _ZNK2v810CpuProfile14GetTopDownRootEv();
        pub(super) fn _ZNK2v810CpuProfile15GetSamplesCountEv();
        pub(super) fn _ZNK2v810CpuProfile18GetSampleTimestampEi();
        pub(super) fn _ZNK2v810CpuProfile9GetSampleEi();
        pub(super) fn _ZNK2v814CpuProfileNode11GetHitCountEv();
        pub(super) fn _ZNK2v814CpuProfileNode11GetScriptIdEv();
        pub(super) fn _ZNK2v814CpuProfileNode12GetLineTicksEPNS0_8LineTickEj();
        pub(super) fn _ZNK2v814CpuProfileNode13GetLineNumberEv();
        pub(super) fn _ZNK2v814CpuProfileNode15GetColumnNumberEv();
        pub(super) fn _ZNK2v814CpuProfileNode15GetFunctionNameEv();
        pub(super) fn _ZNK2v814CpuProfileNode15GetHitLineCountEv();
        pub(super) fn _ZNK2v814CpuProfileNode16GetChildrenCountEv();
        pub(super) fn _ZNK2v814CpuProfileNode18GetFunctionNameStrEv();
        pub(super) fn _ZNK2v814CpuProfileNode21GetScriptResourceNameEv();
        pub(super) fn _ZNK2v814CpuProfileNode8GetChildEi();
        pub(super) fn _ZN2v83Map3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_();
        pub(super) fn _ZN2v83Map6DeleteENS_5LocalINS_7ContextEEENS1_INS_5ValueEEE();
        pub(super) fn uv_os_getpid();
        pub(super) fn uv_os_getppid();
    }
}
#[cfg(windows)]
mod v8_api {
    // MSVC name mangling is different than it is on unix.
    // To make this easier to deal with, this script generates the list of functions.
    //
    // dumpbin .\build\CMakeFiles\bun-debug.dir\src\bun.js\bindings\v8\*.cpp.obj /symbols | where-object { $_.Contains(' node::') -or $_.Contains(' v8::') } | foreach-object { (($_ -split "\|")[1] -split " ")[1] } | ForEach-Object { "extern fn @`"${_}`"() *anyopaque;" }
    //
    // MSVC-mangled symbol names contain `?@$` and are not valid Rust identifiers, so each entry
    // is exposed under a Rust-safe alias via `#[link_name = "..."]`.
    #[rustfmt::skip]
    unsafe extern "C" {
        #[link_name = "?TryGetCurrent@Isolate@v8@@SAPEAV12@XZ"]
        pub(super) fn v8_Isolate_TryGetCurrent();
        #[link_name = "?GetCurrent@Isolate@v8@@SAPEAV12@XZ"]
        pub(super) fn v8_Isolate_GetCurrent();
        #[link_name = "?GetCurrentContext@Isolate@v8@@QEAA?AV?$Local@VContext@v8@@@2@XZ"]
        pub(super) fn v8_Isolate_GetCurrentContext();
        #[link_name = "?GetEnteredOrMicrotaskContext@Isolate@v8@@QEAA?AV?$Local@VContext@v8@@@2@XZ"]
        pub(super) fn v8_Isolate_GetEnteredOrMicrotaskContext();
        #[link_name = "?GetContinuationPreservedEmbedderData@Isolate@v8@@QEAA?AV?$Local@VValue@v8@@@2@XZ"]
        pub(super) fn v8_Isolate_GetContinuationPreservedEmbedderData();
        #[link_name = "?IsInUse@Isolate@v8@@QEAA_NXZ"]
        pub(super) fn v8_Isolate_IsInUse();
        #[link_name = "?LowMemoryNotification@Isolate@v8@@QEAAXXZ"]
        pub(super) fn v8_Isolate_LowMemoryNotification();
        #[link_name = "?AutomaticallyRestoreInitialHeapLimit@Isolate@v8@@QEAAXN@Z"]
        pub(super) fn v8_Isolate_AutomaticallyRestoreInitialHeapLimit();
        #[link_name = "?NumberOfTrackedHeapObjectTypes@Isolate@v8@@QEAA_KXZ"]
        pub(super) fn v8_Isolate_NumberOfTrackedHeapObjectTypes();
        #[link_name = "?GetHeapObjectStatisticsAtLastGC@Isolate@v8@@QEAA_NPEAVHeapObjectStatistics@2@_K@Z"]
        pub(super) fn v8_Isolate_GetHeapObjectStatisticsAtLastGC();
        #[link_name = "?AddGCPrologueCallback@Isolate@v8@@QEAAXP6AXPEAV12@W4GCType@2@W4GCCallbackFlags@2@PEAX@Z31@Z"]
        pub(super) fn v8_Isolate_AddGCPrologueCallback();
        #[link_name = "?RemoveGCPrologueCallback@Isolate@v8@@QEAAXP6AXPEAV12@W4GCType@2@W4GCCallbackFlags@2@PEAX@Z3@Z"]
        pub(super) fn v8_Isolate_RemoveGCPrologueCallback();
        #[link_name = "?AddGCEpilogueCallback@Isolate@v8@@QEAAXP6AXPEAV12@W4GCType@2@W4GCCallbackFlags@2@PEAX@Z31@Z"]
        pub(super) fn v8_Isolate_AddGCEpilogueCallback();
        #[link_name = "?RemoveGCEpilogueCallback@Isolate@v8@@QEAAXP6AXPEAV12@W4GCType@2@W4GCCallbackFlags@2@PEAX@Z3@Z"]
        pub(super) fn v8_Isolate_RemoveGCEpilogueCallback();
        #[link_name = "?AddNearHeapLimitCallback@Isolate@v8@@QEAAXP6A_KPEAX_K1@Z0@Z"]
        pub(super) fn v8_Isolate_AddNearHeapLimitCallback();
        #[link_name = "?RemoveNearHeapLimitCallback@Isolate@v8@@QEAAXP6A_KPEAX_K1@Z1@Z"]
        pub(super) fn v8_Isolate_RemoveNearHeapLimitCallback();
        #[link_name = "?RequestInterrupt@Isolate@v8@@QEAAXP6AXPEAV12@PEAX@Z1@Z"]
        pub(super) fn v8_Isolate_RequestInterrupt();
        #[link_name = "?ThrowException@Isolate@v8@@QEAA?AV?$Local@VValue@v8@@@2@V32@@Z"]
        pub(super) fn v8_Isolate_ThrowException();
        #[link_name = "?ThrowError@Isolate@v8@@QEAA?AV?$Local@VValue@v8@@@2@V?$Local@VString@v8@@@2@@Z"]
        pub(super) fn v8_Isolate_ThrowError();
        #[link_name = "?Error@Exception@v8@@SA?AV?$Local@VValue@v8@@@2@V?$Local@VString@v8@@@2@V32@@Z"]
        pub(super) fn v8_Exception_Error();
        #[link_name = "?TypeError@Exception@v8@@SA?AV?$Local@VValue@v8@@@2@V?$Local@VString@v8@@@2@V32@@Z"]
        pub(super) fn v8_Exception_TypeError();
        #[link_name = "?GetHeapProfiler@Isolate@v8@@QEAAPEAVHeapProfiler@2@XZ"]
        pub(super) fn v8_Isolate_GetHeapProfiler();
        #[link_name = "?StartSamplingHeapProfiler@HeapProfiler@v8@@QEAA_N_KHW4SamplingFlags@12@@Z"]
        pub(super) fn v8_HeapProfiler_StartSamplingHeapProfiler();
        #[link_name = "?StopSamplingHeapProfiler@HeapProfiler@v8@@QEAAXXZ"]
        pub(super) fn v8_HeapProfiler_StopSamplingHeapProfiler();
        #[link_name = "?GetAllocationProfile@HeapProfiler@v8@@QEAAPEAVAllocationProfile@2@XZ"]
        pub(super) fn v8_HeapProfiler_GetAllocationProfile();
        #[link_name = "?AddEnvironmentCleanupHook@node@@YAXPEAVIsolate@v8@@P6AXPEAX@Z1@Z"]
        pub(super) fn node_AddEnvironmentCleanupHook();
        #[link_name = "?RemoveEnvironmentCleanupHook@node@@YAXPEAVIsolate@v8@@P6AXPEAX@Z1@Z"]
        pub(super) fn node_RemoveEnvironmentCleanupHook();
        #[link_name = "?GetCurrentEventLoop@node@@YAPEAUuv_loop_s@@PEAVIsolate@v8@@@Z"]
        pub(super) fn node_GetCurrentEventLoop();
        #[link_name = "?AsyncHooksGetExecutionAsyncId@node@@YANV?$Local@VContext@v8@@@v8@@@Z"]
        pub(super) fn node_AsyncHooksGetExecutionAsyncId();
        #[link_name = "?EmitAsyncInit@node@@YA?AUasync_context@1@PEAVIsolate@v8@@V?$Local@VObject@v8@@@4@V?$Local@VString@v8@@@4@N@Z"]
        pub(super) fn node_EmitAsyncInit();
        #[link_name = "?EmitAsyncDestroy@node@@YAXPEAVIsolate@v8@@Uasync_context@1@@Z"]
        pub(super) fn node_EmitAsyncDestroy();
        #[link_name = "?MakeCallback@node@@YA?AV?$MaybeLocal@VValue@v8@@@v8@@PEAVIsolate@3@V?$Local@VObject@v8@@@3@V?$Local@VFunction@v8@@@3@HPEAV?$Local@VValue@v8@@@3@Uasync_context@1@@Z"]
        pub(super) fn node_MakeCallback();
        #[link_name = "?Now@TimeTicks@base@v8@@SA?AV123@XZ"]
        pub(super) fn v8_base_TimeTicks_Now();
        #[link_name = "?New@Number@v8@@SA?AV?$Local@VNumber@v8@@@2@PEAVIsolate@2@N@Z"]
        pub(super) fn v8_Number_New();
        #[link_name = "?Value@Number@v8@@QEBANXZ"]
        pub(super) fn v8_Number_Value();
        #[link_name = "?NewFromInt32@Number@v8@@CA?AV?$Local@VNumber@v8@@@2@PEAVIsolate@2@H@Z"]
        pub(super) fn v8_Number_NewFromInt32();
        #[link_name = "?NewFromUint32@Number@v8@@CA?AV?$Local@VNumber@v8@@@2@PEAVIsolate@2@I@Z"]
        pub(super) fn v8_Number_NewFromUint32();
        #[link_name = "?NewFromUtf8@String@v8@@SA?AV?$MaybeLocal@VString@v8@@@2@PEAVIsolate@2@PEBDW4NewStringType@2@H@Z"]
        pub(super) fn v8_String_NewFromUtf8();
        #[link_name = "?WriteUtf8@String@v8@@QEBAHPEAVIsolate@2@PEADHPEAHH@Z"]
        pub(super) fn v8_String_WriteUtf8();
        #[link_name = "?ToLocalEmpty@api_internal@v8@@YAXXZ"]
        pub(super) fn v8_api_internal_ToLocalEmpty();
        #[link_name = "?Length@String@v8@@QEBAHXZ"]
        pub(super) fn v8_String_Length();
        #[link_name = "?New@External@v8@@SA?AV?$Local@VExternal@v8@@@2@PEAVIsolate@2@PEAX@Z"]
        pub(super) fn v8_External_New();
        #[link_name = "?Value@External@v8@@QEBAPEAXXZ"]
        pub(super) fn v8_External_Value();
        #[link_name = "?New@External@v8@@SA?AV?$Local@VExternal@v8@@@2@PEAVIsolate@2@PEAXG@Z"]
        pub(super) fn v8_External_New_tagged();
        #[link_name = "?Value@External@v8@@QEBAPEAXG@Z"]
        pub(super) fn v8_External_Value_tagged();
        #[link_name = "?New@Object@v8@@SA?AV?$Local@VObject@v8@@@2@PEAVIsolate@2@@Z"]
        pub(super) fn v8_Object_New();
        #[link_name = "?Set@Object@v8@@QEAA?AV?$Maybe@_N@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@1@Z"]
        pub(super) fn v8_Object_Set_key();
        #[link_name = "?Set@Object@v8@@QEAA?AV?$Maybe@_N@2@V?$Local@VContext@v8@@@2@IV?$Local@VValue@v8@@@2@@Z"]
        pub(super) fn v8_Object_Set_index();
        #[link_name = "?SetInternalField@Object@v8@@QEAAXHV?$Local@VData@v8@@@2@@Z"]
        pub(super) fn v8_Object_SetInternalField();
        #[link_name = "?SlowGetInternalField@Object@v8@@AEAA?AV?$Local@VData@v8@@@2@H@Z"]
        pub(super) fn v8_Object_SlowGetInternalField();
        #[link_name = "?SetAlignedPointerInInternalField@Object@v8@@QEAAXHPEAXG@Z"]
        pub(super) fn v8_Object_SetAlignedPointerInInternalField();
        #[link_name = "?SlowGetAlignedPointerFromInternalField@Object@v8@@AEAAPEAXHG@Z"]
        pub(super) fn v8_Object_SlowGetAlignedPointerFromInternalField();
        #[link_name = "?Get@Object@v8@@QEAA?AV?$MaybeLocal@VValue@v8@@@2@V?$Local@VContext@v8@@@2@I@Z"]
        pub(super) fn v8_Object_Get_index();
        #[link_name = "?Get@Object@v8@@QEAA?AV?$MaybeLocal@VValue@v8@@@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@@Z"]
        pub(super) fn v8_Object_Get_key();
        #[link_name = "?CreateHandle@HandleScope@v8@@KAPEA_KPEAVIsolate@internal@2@_K@Z"]
        pub(super) fn v8_HandleScope_CreateHandle();
        #[link_name = "?Extend@HandleScope@v8@@CAPEA_KPEAVIsolate@2@@Z"]
        pub(super) fn v8_HandleScope_Extend();
        #[link_name = "?DeleteExtensions@HandleScope@v8@@AEAAXPEAVIsolate@2@@Z"]
        pub(super) fn v8_HandleScope_DeleteExtensions();
        #[link_name = "??0HandleScope@v8@@QEAA@PEAVIsolate@1@@Z"]
        pub(super) fn v8_HandleScope_ctor();
        #[link_name = "??1HandleScope@v8@@QEAA@XZ"]
        pub(super) fn v8_HandleScope_dtor();
        #[link_name = "?GetFunction@FunctionTemplate@v8@@QEAA?AV?$MaybeLocal@VFunction@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_FunctionTemplate_GetFunction();
        #[link_name = "?SetClassName@FunctionTemplate@v8@@QEAAXV?$Local@VString@v8@@@2@@Z"]
        pub(super) fn v8_FunctionTemplate_SetClassName();
        #[link_name = "?New@FunctionTemplate@v8@@SA?AV?$Local@VFunctionTemplate@v8@@@2@PEAVIsolate@2@P6AXAEBV?$FunctionCallbackInfo@VValue@v8@@@2@@ZV?$Local@VValue@v8@@@2@V?$Local@VSignature@v8@@@2@HW4ConstructorBehavior@2@W4SideEffectType@2@PEBVCFunction@2@GGG@Z"]
        pub(super) fn v8_FunctionTemplate_New();
        #[link_name = "?NewInstance@ObjectTemplate@v8@@QEAA?AV?$MaybeLocal@VObject@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_ObjectTemplate_NewInstance();
        #[link_name = "?SetInternalFieldCount@ObjectTemplate@v8@@QEAAXH@Z"]
        pub(super) fn v8_ObjectTemplate_SetInternalFieldCount();
        #[link_name = "?InternalFieldCount@ObjectTemplate@v8@@QEBAHXZ"]
        pub(super) fn v8_ObjectTemplate_InternalFieldCount();
        #[link_name = "?New@ObjectTemplate@v8@@SA?AV?$Local@VObjectTemplate@v8@@@2@PEAVIsolate@2@V?$Local@VFunctionTemplate@v8@@@2@@Z"]
        pub(super) fn v8_ObjectTemplate_New();
        #[link_name = "?InstanceTemplate@FunctionTemplate@v8@@QEAA?AV?$Local@VObjectTemplate@v8@@@2@XZ"]
        pub(super) fn v8_FunctionTemplate_InstanceTemplate();
        #[link_name = "?PrototypeTemplate@FunctionTemplate@v8@@QEAA?AV?$Local@VObjectTemplate@v8@@@2@XZ"]
        pub(super) fn v8_FunctionTemplate_PrototypeTemplate();
        #[link_name = "?Set@Template@v8@@QEAAXV?$Local@VName@v8@@@2@V?$Local@VData@v8@@@2@W4PropertyAttribute@2@@Z"]
        pub(super) fn v8_Template_Set();
        #[link_name = "?SetNativeDataProperty@Template@v8@@QEAAXV?$Local@VName@v8@@@2@P6AX0AEBV?$PropertyCallbackInfo@VValue@v8@@@2@@ZP6AX0V?$Local@VValue@v8@@@2@AEBV?$PropertyCallbackInfo@X@2@@Z3W4PropertyAttribute@2@W4SideEffectType@2@7@Z"]
        pub(super) fn v8_Template_SetNativeDataProperty();
        #[link_name = "?New@Signature@v8@@SA?AV?$Local@VSignature@v8@@@2@PEAVIsolate@2@V?$Local@VFunctionTemplate@v8@@@2@@Z"]
        pub(super) fn v8_Signature_New();
        #[link_name = "?EscapeSlot@EscapableHandleScopeBase@v8@@IEAAPEA_KPEA_K@Z"]
        pub(super) fn v8_EscapableHandleScopeBase_EscapeSlot();
        #[link_name = "??0EscapableHandleScopeBase@v8@@QEAA@PEAVIsolate@1@@Z"]
        pub(super) fn v8_EscapableHandleScopeBase_ctor();
        #[link_name = "?IsolateFromNeverReadOnlySpaceObject@internal@v8@@YAPEAVIsolate@12@_K@Z"]
        pub(super) fn v8_internal_IsolateFromNeverReadOnlySpaceObject();
        #[link_name = "?New@Array@v8@@SA?AV?$Local@VArray@v8@@@2@PEAVIsolate@2@PEAV?$Local@VValue@v8@@@2@_K@Z"]
        pub(super) fn v8_Array_New_elements();
        #[link_name = "?Length@Array@v8@@QEBAIXZ"]
        pub(super) fn v8_Array_Length();
        #[link_name = "?New@Array@v8@@SA?AV?$Local@VArray@v8@@@2@PEAVIsolate@2@H@Z"]
        pub(super) fn v8_Array_New_len();
        #[link_name = "?New@Array@v8@@SA?AV?$MaybeLocal@VArray@v8@@@2@V?$Local@VContext@v8@@@2@_KV?$function@$$A6A?AV?$MaybeLocal@VValue@v8@@@v8@@XZ@std@@@Z"]
        pub(super) fn v8_Array_New_fn();
        #[link_name = "?Iterate@Array@v8@@QEAA?AV?$Maybe@X@2@V?$Local@VContext@v8@@@2@P6A?AW4CallbackResult@12@IV?$Local@VValue@v8@@@2@PEAX@Z2@Z"]
        pub(super) fn v8_Array_Iterate();
        #[link_name = "?CheckCast@Array@v8@@CAXPEAVValue@2@@Z"]
        pub(super) fn v8_Array_CheckCast();
        #[link_name = "?SetName@Function@v8@@QEAAXV?$Local@VString@v8@@@2@@Z"]
        pub(super) fn v8_Function_SetName();
        #[link_name = "?Call@Function@v8@@QEAA?AV?$MaybeLocal@VValue@v8@@@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@HQEAV52@@Z"]
        pub(super) fn v8_Function_Call();
        #[link_name = "?NewInstance@Function@v8@@QEBA?AV?$MaybeLocal@VObject@v8@@@2@V?$Local@VContext@v8@@@2@HQEAV?$Local@VValue@v8@@@2@@Z"]
        pub(super) fn v8_Function_NewInstance();
        #[link_name = "?NewInstance@Function@v8@@QEBA?AV?$MaybeLocal@VObject@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_Function_NewInstance_noargs();
        #[link_name = "?GetAlignedPointerFromInternalField@Object@v8@@QEAAPEAXHG@Z"]
        pub(super) fn v8_Object_GetAlignedPointerFromInternalField();
        #[link_name = "?IsBoolean@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsBoolean();
        #[link_name = "?Value@Boolean@v8@@QEBA_NXZ"]
        pub(super) fn v8_Boolean_Value();
        #[link_name = "?FullIsTrue@Value@v8@@AEBA_NXZ"]
        pub(super) fn v8_Value_FullIsTrue();
        #[link_name = "?FullIsFalse@Value@v8@@AEBA_NXZ"]
        pub(super) fn v8_Value_FullIsFalse();
        #[link_name = "??1EscapableHandleScope@v8@@QEAA@XZ"]
        pub(super) fn v8_EscapableHandleScope_dtor();
        #[link_name = "??0EscapableHandleScope@v8@@QEAA@PEAVIsolate@1@@Z"]
        pub(super) fn v8_EscapableHandleScope_ctor();
        #[link_name = "?IsObject@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsObject();
        #[link_name = "?IsNumber@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsNumber();
        #[link_name = "?IsUint32@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsUint32();
        #[link_name = "?Uint32Value@Value@v8@@QEBA?AV?$Maybe@I@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_Value_Uint32Value();
        #[link_name = "?IsUndefined@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsUndefined();
        #[link_name = "?IsNull@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsNull();
        #[link_name = "?IsNullOrUndefined@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsNullOrUndefined();
        #[link_name = "?IsTrue@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsTrue();
        #[link_name = "?IsFalse@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsFalse();
        #[link_name = "?IsString@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsString();
        #[link_name = "?StrictEquals@Value@v8@@QEBA_NV?$Local@VValue@v8@@@2@@Z"]
        pub(super) fn v8_Value_StrictEquals();
        #[link_name = "?New@Boolean@v8@@SA?AV?$Local@VBoolean@v8@@@2@PEAVIsolate@2@_N@Z"]
        pub(super) fn v8_Boolean_New();
        #[link_name = "?GetInternalField@Object@v8@@QEAA?AV?$Local@VData@v8@@@2@H@Z"]
        pub(super) fn v8_Object_GetInternalField();
        #[link_name = "?GetIsolate@Context@v8@@QEAAPEAVIsolate@2@XZ"]
        pub(super) fn v8_Context_GetIsolate();
        #[link_name = "?NewFromOneByte@String@v8@@SA?AV?$MaybeLocal@VString@v8@@@2@PEAVIsolate@2@PEBEW4NewStringType@2@H@Z"]
        pub(super) fn v8_String_NewFromOneByte();
        #[link_name = "?IsExternal@String@v8@@QEBA_NXZ"]
        pub(super) fn v8_String_IsExternal();
        #[link_name = "?IsExternalOneByte@String@v8@@QEBA_NXZ"]
        pub(super) fn v8_String_IsExternalOneByte();
        #[link_name = "?IsExternalTwoByte@String@v8@@QEBA_NXZ"]
        pub(super) fn v8_String_IsExternalTwoByte();
        #[link_name = "?IsOneByte@String@v8@@QEBA_NXZ"]
        pub(super) fn v8_String_IsOneByte();
        #[link_name = "?Utf8Length@String@v8@@QEBAHPEAVIsolate@2@@Z"]
        pub(super) fn v8_String_Utf8Length();
        #[link_name = "?ContainsOnlyOneByte@String@v8@@QEBA_NXZ"]
        pub(super) fn v8_String_ContainsOnlyOneByte();
        #[link_name = "?WriteV2@String@v8@@QEBAXPEAVIsolate@2@IIPEAGH@Z"]
        pub(super) fn v8_String_WriteV2();
        #[link_name = "?WriteOneByteV2@String@v8@@QEBAXPEAVIsolate@2@IIPEAEH@Z"]
        pub(super) fn v8_String_WriteOneByteV2();
        #[link_name = "?WriteUtf8V2@String@v8@@QEBA_KPEAVIsolate@2@PEAD_KHPEA_K@Z"]
        pub(super) fn v8_String_WriteUtf8V2();
        #[link_name = "?Utf8LengthV2@String@v8@@QEBA_KPEAVIsolate@2@@Z"]
        pub(super) fn v8_String_Utf8LengthV2();
        #[link_name = "?GlobalizeReference@api_internal@v8@@YAPEA_KPEAVIsolate@internal@2@_K@Z"]
        pub(super) fn v8_api_internal_GlobalizeReference();
        #[link_name = "?DisposeGlobal@api_internal@v8@@YAXPEA_K@Z"]
        pub(super) fn v8_api_internal_DisposeGlobal();
        #[link_name = "?MakeWeak@api_internal@v8@@YAXPEA_KPEAXP6AXAEBV?$WeakCallbackInfo@X@2@@ZW4WeakCallbackType@2@@Z"]
        pub(super) fn v8_api_internal_MakeWeak();
        #[link_name = "?ClearWeak@api_internal@v8@@YAPEAXPEA_K@Z"]
        pub(super) fn v8_api_internal_ClearWeak();
        #[link_name = "?MoveGlobalReference@api_internal@v8@@YAXPEAPEA_K0@Z"]
        pub(super) fn v8_api_internal_MoveGlobalReference();
        #[link_name = "?GetFunctionTemplateData@api_internal@v8@@YA?AV?$Local@VValue@v8@@@2@PEAVIsolate@2@V?$Local@VData@v8@@@2@@Z"]
        pub(super) fn v8_api_internal_GetFunctionTemplateData();
        #[link_name = "?GetName@Function@v8@@QEBA?AV?$Local@VValue@v8@@@2@XZ"]
        pub(super) fn v8_Function_GetName();
        #[link_name = "?IsFunction@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsFunction();
        #[link_name = "?IsMap@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsMap();
        #[link_name = "?IsArray@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsArray();
        #[link_name = "?IsInt32@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsInt32();
        #[link_name = "?IsBigInt@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsBigInt();
        #[link_name = "?FromJustIsNothing@api_internal@v8@@YAXXZ"]
        pub(super) fn v8_api_internal_FromJustIsNothing();
        #[link_name = "?New@Integer@v8@@SA?AV?$Local@VInteger@v8@@@2@PEAVIsolate@2@H@Z"]
        pub(super) fn v8_Integer_New();
        #[link_name = "?NewFromUnsigned@Integer@v8@@SA?AV?$Local@VInteger@v8@@@2@PEAVIsolate@2@I@Z"]
        pub(super) fn v8_Integer_NewFromUnsigned();
        #[link_name = "?Value@Integer@v8@@QEBA_JXZ"]
        pub(super) fn v8_Integer_Value();
        #[link_name = "?New@BigInt@v8@@SA?AV?$Local@VBigInt@v8@@@2@PEAVIsolate@2@_J@Z"]
        pub(super) fn v8_BigInt_New();
        #[link_name = "?NewFromUtf8Literal@String@v8@@CA?AV?$Local@VString@v8@@@2@PEAVIsolate@2@PEBDW4NewStringType@2@H@Z"]
        pub(super) fn v8_String_NewFromUtf8Literal();
        #[link_name = "?IsUint8Array@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsUint8Array();
        #[link_name = "?ToString@Value@v8@@QEBA?AV?$MaybeLocal@VString@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_Value_ToString();
        #[link_name = "?ToInteger@Value@v8@@QEBA?AV?$MaybeLocal@VInteger@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_Value_ToInteger();
        #[link_name = "?Global@Context@v8@@QEAA?AV?$Local@VObject@v8@@@2@XZ"]
        pub(super) fn v8_Context_Global();
        #[link_name = "?InternalFieldCount@Object@v8@@QEBAHXZ"]
        pub(super) fn v8_Object_InternalFieldCount();
        #[link_name = "?GetIdentityHash@Object@v8@@QEAAHXZ"]
        pub(super) fn v8_Object_GetIdentityHash();
        #[link_name = "?DefineOwnProperty@Object@v8@@QEAA?AV?$Maybe@_N@2@V?$Local@VContext@v8@@@2@V?$Local@VName@v8@@@2@V?$Local@VValue@v8@@@2@W4PropertyAttribute@2@@Z"]
        pub(super) fn v8_Object_DefineOwnProperty();
        #[link_name = "?ToExternalPointerTag@v8@@YA?AW4ExternalPointerTag@internal@1@G@Z"]
        pub(super) fn v8_ToExternalPointerTag();
        #[link_name = "?GetCurrentIsolate@Internals@internal@v8@@SAPEAVIsolate@3@XZ"]
        pub(super) fn v8_internal_Internals_GetCurrentIsolate();
        #[link_name = "??0HeapObjectStatistics@v8@@QEAA@XZ"]
        pub(super) fn v8_HeapObjectStatistics_ctor();
        #[link_name = "?New@ArrayBuffer@v8@@SA?AV?$Local@VArrayBuffer@v8@@@2@PEAVIsolate@2@_KW4BackingStoreInitializationMode@2@@Z"]
        pub(super) fn v8_ArrayBuffer_New();
        #[link_name = "?GetBackingStore@ArrayBuffer@v8@@QEAA?AV?$shared_ptr@VBackingStore@v8@@@std@@XZ"]
        pub(super) fn v8_ArrayBuffer_GetBackingStore();
        #[link_name = "?Data@BackingStore@v8@@QEBAPEAXXZ"]
        pub(super) fn v8_BackingStore_Data();
        #[link_name = "?Buffer@ArrayBufferView@v8@@QEAA?AV?$Local@VArrayBuffer@v8@@@2@XZ"]
        pub(super) fn v8_ArrayBufferView_Buffer();
        #[link_name = "?ByteLength@ArrayBufferView@v8@@QEAA_KXZ"]
        pub(super) fn v8_ArrayBufferView_ByteLength();
        #[link_name = "?ByteOffset@ArrayBufferView@v8@@QEAA_KXZ"]
        pub(super) fn v8_ArrayBufferView_ByteOffset();
        #[link_name = "?New@Uint8Array@v8@@SA?AV?$Local@VUint8Array@v8@@@2@V?$Local@VArrayBuffer@v8@@@2@_K1@Z"]
        pub(super) fn v8_Uint8Array_New();
        #[link_name = "?New@Uint32Array@v8@@SA?AV?$Local@VUint32Array@v8@@@2@V?$Local@VArrayBuffer@v8@@@2@_K1@Z"]
        pub(super) fn v8_Uint32Array_New();
        #[link_name = "?New@CpuProfiler@v8@@SAPEAV12@PEAVIsolate@2@W4CpuProfilingNamingMode@2@W4CpuProfilingLoggingMode@2@@Z"]
        pub(super) fn v8_CpuProfiler_New();
        #[link_name = "?Dispose@CpuProfiler@v8@@QEAAXXZ"]
        pub(super) fn v8_CpuProfiler_Dispose();
        #[link_name = "?SetSamplingInterval@CpuProfiler@v8@@QEAAXH@Z"]
        pub(super) fn v8_CpuProfiler_SetSamplingInterval();
        #[link_name = "?Start@CpuProfiler@v8@@QEAA?AUCpuProfilingResult@2@V?$Local@VString@v8@@@2@W4CpuProfilingMode@2@_NI@Z"]
        pub(super) fn v8_CpuProfiler_Start();
        #[link_name = "?Stop@CpuProfiler@v8@@QEAAPEAVCpuProfile@2@I@Z"]
        pub(super) fn v8_CpuProfiler_Stop();
        #[link_name = "?StartProfiling@CpuProfiler@v8@@QEAA?AW4CpuProfilingStatus@2@V?$Local@VString@v8@@@2@W4CpuProfilingMode@2@_NI@Z"]
        pub(super) fn v8_CpuProfiler_StartProfiling_mode();
        #[link_name = "?StartProfiling@CpuProfiler@v8@@QEAA?AW4CpuProfilingStatus@2@V?$Local@VString@v8@@@2@_N@Z"]
        pub(super) fn v8_CpuProfiler_StartProfiling();
        #[link_name = "?StopProfiling@CpuProfiler@v8@@QEAAPEAVCpuProfile@2@V?$Local@VString@v8@@@2@@Z"]
        pub(super) fn v8_CpuProfiler_StopProfiling();
        #[link_name = "?CollectSample@CpuProfiler@v8@@SAXPEAVIsolate@2@V?$optional@_K@std@@@Z"]
        pub(super) fn v8_CpuProfiler_CollectSample();
        #[link_name = "?Delete@CpuProfile@v8@@QEAAXXZ"]
        pub(super) fn v8_CpuProfile_Delete();
        #[link_name = "?GetTitle@CpuProfile@v8@@QEBA?AV?$Local@VString@v8@@@2@XZ"]
        pub(super) fn v8_CpuProfile_GetTitle();
        #[link_name = "?GetEndTime@CpuProfile@v8@@QEBA_JXZ"]
        pub(super) fn v8_CpuProfile_GetEndTime();
        #[link_name = "?GetStartTime@CpuProfile@v8@@QEBA_JXZ"]
        pub(super) fn v8_CpuProfile_GetStartTime();
        #[link_name = "?GetTopDownRoot@CpuProfile@v8@@QEBAPEBVCpuProfileNode@2@XZ"]
        pub(super) fn v8_CpuProfile_GetTopDownRoot();
        #[link_name = "?GetSamplesCount@CpuProfile@v8@@QEBAHXZ"]
        pub(super) fn v8_CpuProfile_GetSamplesCount();
        #[link_name = "?GetSampleTimestamp@CpuProfile@v8@@QEBA_JH@Z"]
        pub(super) fn v8_CpuProfile_GetSampleTimestamp();
        #[link_name = "?GetSample@CpuProfile@v8@@QEBAPEBVCpuProfileNode@2@H@Z"]
        pub(super) fn v8_CpuProfile_GetSample();
        #[link_name = "?GetHitCount@CpuProfileNode@v8@@QEBAIXZ"]
        pub(super) fn v8_CpuProfileNode_GetHitCount();
        #[link_name = "?GetScriptId@CpuProfileNode@v8@@QEBAHXZ"]
        pub(super) fn v8_CpuProfileNode_GetScriptId();
        #[link_name = "?GetLineTicks@CpuProfileNode@v8@@QEBA_NPEAULineTick@12@I@Z"]
        pub(super) fn v8_CpuProfileNode_GetLineTicks();
        #[link_name = "?GetLineNumber@CpuProfileNode@v8@@QEBAHXZ"]
        pub(super) fn v8_CpuProfileNode_GetLineNumber();
        #[link_name = "?GetColumnNumber@CpuProfileNode@v8@@QEBAHXZ"]
        pub(super) fn v8_CpuProfileNode_GetColumnNumber();
        #[link_name = "?GetFunctionName@CpuProfileNode@v8@@QEBA?AV?$Local@VString@v8@@@2@XZ"]
        pub(super) fn v8_CpuProfileNode_GetFunctionName();
        #[link_name = "?GetHitLineCount@CpuProfileNode@v8@@QEBAIXZ"]
        pub(super) fn v8_CpuProfileNode_GetHitLineCount();
        #[link_name = "?GetChildrenCount@CpuProfileNode@v8@@QEBAHXZ"]
        pub(super) fn v8_CpuProfileNode_GetChildrenCount();
        #[link_name = "?GetFunctionNameStr@CpuProfileNode@v8@@QEBAPEBDXZ"]
        pub(super) fn v8_CpuProfileNode_GetFunctionNameStr();
        #[link_name = "?GetScriptResourceName@CpuProfileNode@v8@@QEBA?AV?$Local@VString@v8@@@2@XZ"]
        pub(super) fn v8_CpuProfileNode_GetScriptResourceName();
        #[link_name = "?GetChild@CpuProfileNode@v8@@QEBAPEBV12@H@Z"]
        pub(super) fn v8_CpuProfileNode_GetChild();
        #[link_name = "?Set@Map@v8@@QEAA?AV?$MaybeLocal@VMap@v8@@@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@1@Z"]
        pub(super) fn v8_Map_Set();
        #[link_name = "?Delete@Map@v8@@QEAA?AV?$Maybe@_N@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@@Z"]
        pub(super) fn v8_Map_Delete();
    }
}
// Per-platform v8 symbols whose mangling differs by C++ standard library.
#[cfg(windows)]
mod posix_platform_specific_v8_apis {}
#[cfg(all(not(windows), target_os = "android"))]
mod posix_platform_specific_v8_apis {
    unsafe extern "C" {
        pub(super) fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt6__ndk18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE()
        ;
        pub(super) fn _ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt6__ndk18optionalImEE();
        pub(super) fn _ZN2v86BigInt3NewEPNS_7IsolateEl();
        pub(super) fn _ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE();
    }
}
#[cfg(all(not(windows), target_os = "macos"))]
mod posix_platform_specific_v8_apis {
    unsafe extern "C" {
        pub(super) fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt3__18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE()
        ;
        pub(super) fn _ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt3__18optionalIyEE();
        pub(super) fn _ZN2v86BigInt3NewEPNS_7IsolateEx();
        pub(super) fn _ZN2v812HeapProfiler25StartSamplingHeapProfilerEyiNS0_13SamplingFlagsE();
    }
}
#[cfg(all(not(windows), target_os = "freebsd"))]
mod posix_platform_specific_v8_apis {
    unsafe extern "C" {
        pub(super) fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt3__18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE()
        ;
        pub(super) fn _ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt3__18optionalImEE();
        pub(super) fn _ZN2v86BigInt3NewEPNS_7IsolateEl();
        pub(super) fn _ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE();
    }
}
#[cfg(all(
    not(windows),
    not(target_os = "android"),
    not(target_os = "macos"),
    not(target_os = "freebsd")
))]
mod posix_platform_specific_v8_apis {
    unsafe extern "C" {
        pub(super) fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmSt8functionIFNS_10MaybeLocalINS_5ValueEEEvEE()
        ;
        pub(super) fn _ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateESt8optionalImE();
        pub(super) fn _ZN2v86BigInt3NewEPNS_7IsolateEl();
        pub(super) fn _ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE();
    }
}
// uv_* symbols (the posix polyfills; on Windows libuv itself is linked).
#[cfg(unix)]
mod uv_functions_to_export {
    unsafe extern "C" {
        pub(super) fn uv_accept();
        pub(super) fn uv_async_init();
        pub(super) fn uv_async_send();
        pub(super) fn uv_available_parallelism();
        pub(super) fn uv_backend_fd();
        pub(super) fn uv_backend_timeout();
        pub(super) fn uv_barrier_destroy();
        pub(super) fn uv_barrier_init();
        pub(super) fn uv_barrier_wait();
        pub(super) fn uv_buf_init();
        pub(super) fn uv_cancel();
        pub(super) fn uv_chdir();
        pub(super) fn uv_check_init();
        pub(super) fn uv_check_start();
        pub(super) fn uv_check_stop();
        pub(super) fn uv_clock_gettime();
        pub(super) fn uv_close();
        pub(super) fn uv_cond_broadcast();
        pub(super) fn uv_cond_destroy();
        pub(super) fn uv_cond_init();
        pub(super) fn uv_cond_signal();
        pub(super) fn uv_cond_timedwait();
        pub(super) fn uv_cond_wait();
        pub(super) fn uv_cpu_info();
        pub(super) fn uv_cpumask_size();
        pub(super) fn uv_cwd();
        pub(super) fn uv_default_loop();
        pub(super) fn uv_disable_stdio_inheritance();
        pub(super) fn uv_dlclose();
        pub(super) fn uv_dlerror();
        pub(super) fn uv_dlopen();
        pub(super) fn uv_dlsym();
        pub(super) fn uv_err_name();
        pub(super) fn uv_err_name_r();
        pub(super) fn uv_exepath();
        pub(super) fn uv_fileno();
        pub(super) fn uv_free_cpu_info();
        pub(super) fn uv_free_interface_addresses();
        pub(super) fn uv_freeaddrinfo();
        pub(super) fn uv_fs_access();
        pub(super) fn uv_fs_chmod();
        pub(super) fn uv_fs_chown();
        pub(super) fn uv_fs_close();
        pub(super) fn uv_fs_closedir();
        pub(super) fn uv_fs_copyfile();
        pub(super) fn uv_fs_event_getpath();
        pub(super) fn uv_fs_event_init();
        pub(super) fn uv_fs_event_start();
        pub(super) fn uv_fs_event_stop();
        pub(super) fn uv_fs_fchmod();
        pub(super) fn uv_fs_fchown();
        pub(super) fn uv_fs_fdatasync();
        pub(super) fn uv_fs_fstat();
        pub(super) fn uv_fs_fsync();
        pub(super) fn uv_fs_ftruncate();
        pub(super) fn uv_fs_futime();
        pub(super) fn uv_fs_get_path();
        pub(super) fn uv_fs_get_ptr();
        pub(super) fn uv_fs_get_result();
        pub(super) fn uv_fs_get_statbuf();
        pub(super) fn uv_fs_get_system_error();
        pub(super) fn uv_fs_get_type();
        pub(super) fn uv_fs_lchown();
        pub(super) fn uv_fs_link();
        pub(super) fn uv_fs_lstat();
        pub(super) fn uv_fs_lutime();
        pub(super) fn uv_fs_mkdir();
        pub(super) fn uv_fs_mkdtemp();
        pub(super) fn uv_fs_mkstemp();
        pub(super) fn uv_fs_open();
        pub(super) fn uv_fs_opendir();
        pub(super) fn uv_fs_poll_getpath();
        pub(super) fn uv_fs_poll_init();
        pub(super) fn uv_fs_poll_start();
        pub(super) fn uv_fs_poll_stop();
        pub(super) fn uv_fs_read();
        pub(super) fn uv_fs_readdir();
        pub(super) fn uv_fs_readlink();
        pub(super) fn uv_fs_realpath();
        pub(super) fn uv_fs_rename();
        pub(super) fn uv_fs_req_cleanup();
        pub(super) fn uv_fs_rmdir();
        pub(super) fn uv_fs_scandir();
        pub(super) fn uv_fs_scandir_next();
        pub(super) fn uv_fs_sendfile();
        pub(super) fn uv_fs_stat();
        pub(super) fn uv_fs_statfs();
        pub(super) fn uv_fs_symlink();
        pub(super) fn uv_fs_unlink();
        pub(super) fn uv_fs_utime();
        pub(super) fn uv_fs_write();
        pub(super) fn uv_get_available_memory();
        pub(super) fn uv_get_constrained_memory();
        pub(super) fn uv_get_free_memory();
        pub(super) fn uv_get_osfhandle();
        pub(super) fn uv_get_process_title();
        pub(super) fn uv_get_total_memory();
        pub(super) fn uv_getaddrinfo();
        pub(super) fn uv_getnameinfo();
        pub(super) fn uv_getrusage();
        pub(super) fn uv_getrusage_thread();
        pub(super) fn uv_gettimeofday();
        pub(super) fn uv_guess_handle();
        pub(super) fn uv_handle_get_data();
        pub(super) fn uv_handle_get_loop();
        pub(super) fn uv_handle_get_type();
        pub(super) fn uv_handle_set_data();
        pub(super) fn uv_handle_size();
        pub(super) fn uv_handle_type_name();
        pub(super) fn uv_has_ref();
        pub(super) fn uv_hrtime();
        pub(super) fn uv_idle_init();
        pub(super) fn uv_idle_start();
        pub(super) fn uv_idle_stop();
        pub(super) fn uv_if_indextoiid();
        pub(super) fn uv_if_indextoname();
        pub(super) fn uv_inet_ntop();
        pub(super) fn uv_inet_pton();
        pub(super) fn uv_interface_addresses();
        pub(super) fn uv_ip_name();
        pub(super) fn uv_ip4_addr();
        pub(super) fn uv_ip4_name();
        pub(super) fn uv_ip6_addr();
        pub(super) fn uv_ip6_name();
        pub(super) fn uv_is_active();
        pub(super) fn uv_is_closing();
        pub(super) fn uv_is_readable();
        pub(super) fn uv_is_writable();
        pub(super) fn uv_key_create();
        pub(super) fn uv_key_delete();
        pub(super) fn uv_key_get();
        pub(super) fn uv_key_set();
        pub(super) fn uv_kill();
        pub(super) fn uv_library_shutdown();
        pub(super) fn uv_listen();
        pub(super) fn uv_loadavg();
        pub(super) fn uv_loop_alive();
        pub(super) fn uv_loop_close();
        pub(super) fn uv_loop_configure();
        pub(super) fn uv_loop_delete();
        pub(super) fn uv_loop_fork();
        pub(super) fn uv_loop_get_data();
        pub(super) fn uv_loop_init();
        pub(super) fn uv_loop_new();
        pub(super) fn uv_loop_set_data();
        pub(super) fn uv_loop_size();
        pub(super) fn uv_metrics_idle_time();
        pub(super) fn uv_metrics_info();
        pub(super) fn uv_mutex_destroy();
        pub(super) fn uv_mutex_init();
        pub(super) fn uv_mutex_init_recursive();
        pub(super) fn uv_mutex_lock();
        pub(super) fn uv_mutex_trylock();
        pub(super) fn uv_mutex_unlock();
        pub(super) fn uv_now();
        pub(super) fn uv_once();
        pub(super) fn uv_open_osfhandle();
        pub(super) fn uv_os_environ();
        pub(super) fn uv_os_free_environ();
        pub(super) fn uv_os_free_group();
        pub(super) fn uv_os_free_passwd();
        pub(super) fn uv_os_get_group();
        pub(super) fn uv_os_get_passwd();
        pub(super) fn uv_os_get_passwd2();
        pub(super) fn uv_os_getenv();
        pub(super) fn uv_os_gethostname();
        pub(super) fn uv_os_getpid();
        pub(super) fn uv_os_getppid();
        pub(super) fn uv_os_getpriority();
        pub(super) fn uv_os_homedir();
        pub(super) fn uv_os_setenv();
        pub(super) fn uv_os_setpriority();
        pub(super) fn uv_os_tmpdir();
        pub(super) fn uv_os_uname();
        pub(super) fn uv_os_unsetenv();
        pub(super) fn uv_pipe();
        pub(super) fn uv_pipe_bind();
        pub(super) fn uv_pipe_bind2();
        pub(super) fn uv_pipe_chmod();
        pub(super) fn uv_pipe_connect();
        pub(super) fn uv_pipe_connect2();
        pub(super) fn uv_pipe_getpeername();
        pub(super) fn uv_pipe_getsockname();
        pub(super) fn uv_pipe_init();
        pub(super) fn uv_pipe_open();
        pub(super) fn uv_pipe_pending_count();
        pub(super) fn uv_pipe_pending_instances();
        pub(super) fn uv_pipe_pending_type();
        pub(super) fn uv_poll_init();
        pub(super) fn uv_poll_init_socket();
        pub(super) fn uv_poll_start();
        pub(super) fn uv_poll_stop();
        pub(super) fn uv_prepare_init();
        pub(super) fn uv_prepare_start();
        pub(super) fn uv_prepare_stop();
        pub(super) fn uv_print_active_handles();
        pub(super) fn uv_print_all_handles();
        pub(super) fn uv_process_get_pid();
        pub(super) fn uv_process_kill();
        pub(super) fn uv_queue_work();
        pub(super) fn uv_random();
        pub(super) fn uv_read_start();
        pub(super) fn uv_read_stop();
        pub(super) fn uv_recv_buffer_size();
        pub(super) fn uv_ref();
        pub(super) fn uv_replace_allocator();
        pub(super) fn uv_req_get_data();
        pub(super) fn uv_req_get_type();
        pub(super) fn uv_req_set_data();
        pub(super) fn uv_req_size();
        pub(super) fn uv_req_type_name();
        pub(super) fn uv_resident_set_memory();
        pub(super) fn uv_run();
        pub(super) fn uv_rwlock_destroy();
        pub(super) fn uv_rwlock_init();
        pub(super) fn uv_rwlock_rdlock();
        pub(super) fn uv_rwlock_rdunlock();
        pub(super) fn uv_rwlock_tryrdlock();
        pub(super) fn uv_rwlock_trywrlock();
        pub(super) fn uv_rwlock_wrlock();
        pub(super) fn uv_rwlock_wrunlock();
        pub(super) fn uv_sem_destroy();
        pub(super) fn uv_sem_init();
        pub(super) fn uv_sem_post();
        pub(super) fn uv_sem_trywait();
        pub(super) fn uv_sem_wait();
        pub(super) fn uv_send_buffer_size();
        pub(super) fn uv_set_process_title();
        pub(super) fn uv_setup_args();
        pub(super) fn uv_shutdown();
        pub(super) fn uv_signal_init();
        pub(super) fn uv_signal_start();
        pub(super) fn uv_signal_start_oneshot();
        pub(super) fn uv_signal_stop();
        pub(super) fn uv_sleep();
        pub(super) fn uv_socketpair();
        pub(super) fn uv_spawn();
        pub(super) fn uv_stop();
        pub(super) fn uv_stream_get_write_queue_size();
        pub(super) fn uv_stream_set_blocking();
        pub(super) fn uv_strerror();
        pub(super) fn uv_strerror_r();
        pub(super) fn uv_tcp_bind();
        pub(super) fn uv_tcp_close_reset();
        pub(super) fn uv_tcp_connect();
        pub(super) fn uv_tcp_getpeername();
        pub(super) fn uv_tcp_getsockname();
        pub(super) fn uv_tcp_init();
        pub(super) fn uv_tcp_init_ex();
        pub(super) fn uv_tcp_keepalive();
        pub(super) fn uv_tcp_nodelay();
        pub(super) fn uv_tcp_open();
        pub(super) fn uv_tcp_simultaneous_accepts();
        pub(super) fn uv_thread_create();
        pub(super) fn uv_thread_create_ex();
        pub(super) fn uv_thread_detach();
        pub(super) fn uv_thread_equal();
        pub(super) fn uv_thread_getaffinity();
        pub(super) fn uv_thread_getcpu();
        pub(super) fn uv_thread_getname();
        pub(super) fn uv_thread_getpriority();
        pub(super) fn uv_thread_join();
        pub(super) fn uv_thread_self();
        pub(super) fn uv_thread_setaffinity();
        pub(super) fn uv_thread_setname();
        pub(super) fn uv_thread_setpriority();
        pub(super) fn uv_timer_again();
        pub(super) fn uv_timer_get_due_in();
        pub(super) fn uv_timer_get_repeat();
        pub(super) fn uv_timer_init();
        pub(super) fn uv_timer_set_repeat();
        pub(super) fn uv_timer_start();
        pub(super) fn uv_timer_stop();
        pub(super) fn uv_translate_sys_error();
        pub(super) fn uv_try_write();
        pub(super) fn uv_try_write2();
        pub(super) fn uv_tty_get_vterm_state();
        pub(super) fn uv_tty_get_winsize();
        pub(super) fn uv_tty_init();
        pub(super) fn uv_tty_reset_mode();
        pub(super) fn uv_tty_set_mode();
        pub(super) fn uv_tty_set_vterm_state();
        pub(super) fn uv_udp_bind();
        pub(super) fn uv_udp_connect();
        pub(super) fn uv_udp_get_send_queue_count();
        pub(super) fn uv_udp_get_send_queue_size();
        pub(super) fn uv_udp_getpeername();
        pub(super) fn uv_udp_getsockname();
        pub(super) fn uv_udp_init();
        pub(super) fn uv_udp_init_ex();
        pub(super) fn uv_udp_open();
        pub(super) fn uv_udp_recv_start();
        pub(super) fn uv_udp_recv_stop();
        pub(super) fn uv_udp_send();
        pub(super) fn uv_udp_set_broadcast();
        pub(super) fn uv_udp_set_membership();
        pub(super) fn uv_udp_set_multicast_interface();
        pub(super) fn uv_udp_set_multicast_loop();
        pub(super) fn uv_udp_set_multicast_ttl();
        pub(super) fn uv_udp_set_source_membership();
        pub(super) fn uv_udp_set_ttl();
        pub(super) fn uv_udp_try_send();
        pub(super) fn uv_udp_try_send2();
        pub(super) fn uv_udp_using_recvmmsg();
        pub(super) fn uv_unref();
        pub(super) fn uv_update_time();
        pub(super) fn uv_uptime();
        pub(super) fn uv_utf16_length_as_wtf8();
        pub(super) fn uv_utf16_to_wtf8();
        pub(super) fn uv_version();
        pub(super) fn uv_version_string();
        pub(super) fn uv_walk();
        pub(super) fn uv_write();
        pub(super) fn uv_write2();
        pub(super) fn uv_wtf8_length_as_utf16();
        pub(super) fn uv_wtf8_to_utf16();
    }
}
pub(super) fn keep() {
    keep_symbols!(
        napi_add_async_cleanup_hook,
        napi_add_env_cleanup_hook,
        napi_add_finalizer,
        napi_adjust_external_memory,
        napi_call_function,
        napi_check_object_type_tag,
        napi_coerce_to_bool,
        napi_coerce_to_number,
        napi_coerce_to_object,
        napi_create_arraybuffer,
        napi_create_bigint_int64,
        napi_create_bigint_uint64,
        napi_create_bigint_words,
        napi_create_buffer,
        napi_create_buffer_copy,
        napi_create_dataview,
        napi_create_double,
        napi_create_error,
        napi_create_external,
        napi_create_external_arraybuffer,
        napi_create_external_buffer,
        napi_create_object,
        napi_create_range_error,
        napi_create_reference,
        napi_create_symbol,
        napi_create_type_error,
        napi_create_typedarray,
        napi_define_class,
        napi_define_properties,
        napi_delete_element,
        napi_delete_reference,
        napi_detach_arraybuffer,
        napi_fatal_exception,
        napi_get_all_property_names,
        napi_get_and_clear_last_exception,
        napi_get_cb_info,
        napi_get_date_value,
        napi_get_element,
        napi_get_global,
        napi_get_instance_data,
        napi_get_last_error_info,
        napi_get_new_target,
        napi_get_reference_value,
        napi_get_value_bigint_int64,
        napi_get_value_bigint_uint64,
        napi_get_value_bigint_words,
        napi_get_value_bool,
        napi_get_value_double,
        napi_get_value_external,
        napi_get_value_int32,
        napi_get_value_int64,
        napi_get_value_string_latin1,
        napi_get_value_string_utf16,
        napi_get_value_string_utf8,
        napi_get_value_uint32,
        napi_has_element,
        napi_instanceof,
        napi_is_buffer,
        napi_is_detached_arraybuffer,
        napi_is_exception_pending,
        napi_is_typedarray,
        napi_new_instance,
        napi_reference_ref,
        napi_reference_unref,
        napi_remove_async_cleanup_hook,
        napi_remove_env_cleanup_hook,
        napi_remove_wrap,
        napi_run_script,
        napi_set_element,
        napi_set_instance_data,
        napi_throw,
        napi_throw_error,
        napi_throw_range_error,
        napi_throw_type_error,
        napi_type_tag_object,
        napi_typeof,
        napi_unwrap,
        napi_wrap,
        node_api_create_syntax_error,
        node_api_symbol_for,
        node_api_throw_syntax_error,
        node_api_create_external_string_latin1,
        node_api_create_external_string_utf16,
        node_api_set_prototype,
        node_api_create_object_with_properties,
        node_api_create_sharedarraybuffer,
        node_api_create_external_sharedarraybuffer,
        node_api_is_sharedarraybuffer,
    );
    #[cfg(unix)]
    {
        use uv_functions_to_export::*;
        keep_symbols!(
            uv_accept,
            uv_async_init,
            uv_async_send,
            uv_available_parallelism,
            uv_backend_fd,
            uv_backend_timeout,
            uv_barrier_destroy,
            uv_barrier_init,
            uv_barrier_wait,
            uv_buf_init,
            uv_cancel,
            uv_chdir,
            uv_check_init,
            uv_check_start,
            uv_check_stop,
            uv_clock_gettime,
            uv_close,
            uv_cond_broadcast,
            uv_cond_destroy,
            uv_cond_init,
            uv_cond_signal,
            uv_cond_timedwait,
            uv_cond_wait,
            uv_cpu_info,
            uv_cpumask_size,
            uv_cwd,
            uv_default_loop,
            uv_disable_stdio_inheritance,
            uv_dlclose,
            uv_dlerror,
            uv_dlopen,
            uv_dlsym,
            uv_err_name,
            uv_err_name_r,
            uv_exepath,
            uv_fileno,
            uv_free_cpu_info,
            uv_free_interface_addresses,
            uv_freeaddrinfo,
            uv_fs_access,
            uv_fs_chmod,
            uv_fs_chown,
            uv_fs_close,
            uv_fs_closedir,
            uv_fs_copyfile,
            uv_fs_event_getpath,
            uv_fs_event_init,
            uv_fs_event_start,
            uv_fs_event_stop,
            uv_fs_fchmod,
            uv_fs_fchown,
            uv_fs_fdatasync,
            uv_fs_fstat,
            uv_fs_fsync,
            uv_fs_ftruncate,
            uv_fs_futime,
            uv_fs_get_path,
            uv_fs_get_ptr,
            uv_fs_get_result,
            uv_fs_get_statbuf,
            uv_fs_get_system_error,
            uv_fs_get_type,
            uv_fs_lchown,
            uv_fs_link,
            uv_fs_lstat,
            uv_fs_lutime,
            uv_fs_mkdir,
            uv_fs_mkdtemp,
            uv_fs_mkstemp,
            uv_fs_open,
            uv_fs_opendir,
            uv_fs_poll_getpath,
            uv_fs_poll_init,
            uv_fs_poll_start,
            uv_fs_poll_stop,
            uv_fs_read,
            uv_fs_readdir,
            uv_fs_readlink,
            uv_fs_realpath,
            uv_fs_rename,
            uv_fs_req_cleanup,
            uv_fs_rmdir,
            uv_fs_scandir,
            uv_fs_scandir_next,
            uv_fs_sendfile,
            uv_fs_stat,
            uv_fs_statfs,
            uv_fs_symlink,
            uv_fs_unlink,
            uv_fs_utime,
            uv_fs_write,
            uv_get_available_memory,
            uv_get_constrained_memory,
            uv_get_free_memory,
            uv_get_osfhandle,
            uv_get_process_title,
            uv_get_total_memory,
            uv_getaddrinfo,
            uv_getnameinfo,
            uv_getrusage,
            uv_getrusage_thread,
            uv_gettimeofday,
            uv_guess_handle,
            uv_handle_get_data,
            uv_handle_get_loop,
            uv_handle_get_type,
            uv_handle_set_data,
            uv_handle_size,
            uv_handle_type_name,
            uv_has_ref,
            uv_hrtime,
            uv_idle_init,
            uv_idle_start,
            uv_idle_stop,
            uv_if_indextoiid,
            uv_if_indextoname,
            uv_inet_ntop,
            uv_inet_pton,
            uv_interface_addresses,
            uv_ip_name,
            uv_ip4_addr,
            uv_ip4_name,
            uv_ip6_addr,
            uv_ip6_name,
            uv_is_active,
            uv_is_closing,
            uv_is_readable,
            uv_is_writable,
            uv_key_create,
            uv_key_delete,
            uv_key_get,
            uv_key_set,
            uv_kill,
            uv_library_shutdown,
            uv_listen,
            uv_loadavg,
            uv_loop_alive,
            uv_loop_close,
            uv_loop_configure,
            uv_loop_delete,
            uv_loop_fork,
            uv_loop_get_data,
            uv_loop_init,
            uv_loop_new,
            uv_loop_set_data,
            uv_loop_size,
            uv_metrics_idle_time,
            uv_metrics_info,
            uv_mutex_destroy,
            uv_mutex_init,
            uv_mutex_init_recursive,
            uv_mutex_lock,
            uv_mutex_trylock,
            uv_mutex_unlock,
            uv_now,
            uv_once,
            uv_open_osfhandle,
            uv_os_environ,
            uv_os_free_environ,
            uv_os_free_group,
            uv_os_free_passwd,
            uv_os_get_group,
            uv_os_get_passwd,
            uv_os_get_passwd2,
            uv_os_getenv,
            uv_os_gethostname,
            uv_os_getpid,
            uv_os_getppid,
            uv_os_getpriority,
            uv_os_homedir,
            uv_os_setenv,
            uv_os_setpriority,
            uv_os_tmpdir,
            uv_os_uname,
            uv_os_unsetenv,
            uv_pipe,
            uv_pipe_bind,
            uv_pipe_bind2,
            uv_pipe_chmod,
            uv_pipe_connect,
            uv_pipe_connect2,
            uv_pipe_getpeername,
            uv_pipe_getsockname,
            uv_pipe_init,
            uv_pipe_open,
            uv_pipe_pending_count,
            uv_pipe_pending_instances,
            uv_pipe_pending_type,
            uv_poll_init,
            uv_poll_init_socket,
            uv_poll_start,
            uv_poll_stop,
            uv_prepare_init,
            uv_prepare_start,
            uv_prepare_stop,
            uv_print_active_handles,
            uv_print_all_handles,
            uv_process_get_pid,
            uv_process_kill,
            uv_queue_work,
            uv_random,
            uv_read_start,
            uv_read_stop,
            uv_recv_buffer_size,
            uv_ref,
            uv_replace_allocator,
            uv_req_get_data,
            uv_req_get_type,
            uv_req_set_data,
            uv_req_size,
            uv_req_type_name,
            uv_resident_set_memory,
            uv_run,
            uv_rwlock_destroy,
            uv_rwlock_init,
            uv_rwlock_rdlock,
            uv_rwlock_rdunlock,
            uv_rwlock_tryrdlock,
            uv_rwlock_trywrlock,
            uv_rwlock_wrlock,
            uv_rwlock_wrunlock,
            uv_sem_destroy,
            uv_sem_init,
            uv_sem_post,
            uv_sem_trywait,
            uv_sem_wait,
            uv_send_buffer_size,
            uv_set_process_title,
            uv_setup_args,
            uv_shutdown,
            uv_signal_init,
            uv_signal_start,
            uv_signal_start_oneshot,
            uv_signal_stop,
            uv_sleep,
            uv_socketpair,
            uv_spawn,
            uv_stop,
            uv_stream_get_write_queue_size,
            uv_stream_set_blocking,
            uv_strerror,
            uv_strerror_r,
            uv_tcp_bind,
            uv_tcp_close_reset,
            uv_tcp_connect,
            uv_tcp_getpeername,
            uv_tcp_getsockname,
            uv_tcp_init,
            uv_tcp_init_ex,
            uv_tcp_keepalive,
            uv_tcp_nodelay,
            uv_tcp_open,
            uv_tcp_simultaneous_accepts,
            uv_thread_create,
            uv_thread_create_ex,
            uv_thread_detach,
            uv_thread_equal,
            uv_thread_getaffinity,
            uv_thread_getcpu,
            uv_thread_getname,
            uv_thread_getpriority,
            uv_thread_join,
            uv_thread_self,
            uv_thread_setaffinity,
            uv_thread_setname,
            uv_thread_setpriority,
            uv_timer_again,
            uv_timer_get_due_in,
            uv_timer_get_repeat,
            uv_timer_init,
            uv_timer_set_repeat,
            uv_timer_start,
            uv_timer_stop,
            uv_translate_sys_error,
            uv_try_write,
            uv_try_write2,
            uv_tty_get_vterm_state,
            uv_tty_get_winsize,
            uv_tty_init,
            uv_tty_reset_mode,
            uv_tty_set_mode,
            uv_tty_set_vterm_state,
            uv_udp_bind,
            uv_udp_connect,
            uv_udp_get_send_queue_count,
            uv_udp_get_send_queue_size,
            uv_udp_getpeername,
            uv_udp_getsockname,
            uv_udp_init,
            uv_udp_init_ex,
            uv_udp_open,
            uv_udp_recv_start,
            uv_udp_recv_stop,
            uv_udp_send,
            uv_udp_set_broadcast,
            uv_udp_set_membership,
            uv_udp_set_multicast_interface,
            uv_udp_set_multicast_loop,
            uv_udp_set_multicast_ttl,
            uv_udp_set_source_membership,
            uv_udp_set_ttl,
            uv_udp_try_send,
            uv_udp_try_send2,
            uv_udp_using_recvmmsg,
            uv_unref,
            uv_update_time,
            uv_uptime,
            uv_utf16_length_as_wtf8,
            uv_utf16_to_wtf8,
            uv_version,
            uv_version_string,
            uv_walk,
            uv_write,
            uv_write2,
            uv_wtf8_length_as_utf16,
            uv_wtf8_to_utf16,
        );
    }
    #[cfg(not(windows))]
    {
        use v8_api::*;
        keep_symbols!(
            _ZN2v87Isolate10GetCurrentEv,
            _ZN2v87Isolate13TryGetCurrentEv,
            _ZN2v87Isolate17GetCurrentContextEv,
            _ZN2v87Isolate28GetEnteredOrMicrotaskContextEv,
            _ZN2v87Isolate36GetContinuationPreservedEmbedderDataEv,
            _ZN2v87Isolate7IsInUseEv,
            _ZN2v87Isolate21LowMemoryNotificationEv,
            _ZN2v87Isolate36AutomaticallyRestoreInitialHeapLimitEd,
            _ZN2v87Isolate30NumberOfTrackedHeapObjectTypesEv,
            _ZN2v87Isolate31GetHeapObjectStatisticsAtLastGCEPNS_20HeapObjectStatisticsEm,
            _ZN2v87Isolate21AddGCPrologueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_S2_,
            _ZN2v87Isolate24RemoveGCPrologueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_,
            _ZN2v87Isolate21AddGCEpilogueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_S2_,
            _ZN2v87Isolate24RemoveGCEpilogueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_,
            _ZN2v87Isolate24AddNearHeapLimitCallbackEPFmPvmmES1_,
            _ZN2v87Isolate27RemoveNearHeapLimitCallbackEPFmPvmmEm,
            _ZN2v87Isolate16RequestInterruptEPFvPS0_PvES2_,
            _ZN2v87Isolate14ThrowExceptionENS_5LocalINS_5ValueEEE,
            _ZN2v87Isolate10ThrowErrorENS_5LocalINS_6StringEEE,
            _ZN2v89Exception5ErrorENS_5LocalINS_6StringEEENS1_INS_5ValueEEE,
            _ZN2v89Exception9TypeErrorENS_5LocalINS_6StringEEENS1_INS_5ValueEEE,
            _ZN2v87Isolate15GetHeapProfilerEv,
            _ZN2v812HeapProfiler24StopSamplingHeapProfilerEv,
            _ZN2v812HeapProfiler20GetAllocationProfileEv,
            _ZN4node25AddEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_,
            _ZN4node28RemoveEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_,
            _ZN4node19GetCurrentEventLoopEPN2v87IsolateE,
            _ZN4node29AsyncHooksGetExecutionAsyncIdEN2v85LocalINS0_7ContextEEE,
            _ZN4node13EmitAsyncInitEPN2v87IsolateENS0_5LocalINS0_6ObjectEEENS3_INS0_6StringEEEd,
            _ZN4node16EmitAsyncDestroyEPN2v87IsolateENS_13async_contextE,
            _ZN4node12MakeCallbackEPN2v87IsolateENS0_5LocalINS0_6ObjectEEENS3_INS0_8FunctionEEEiPNS3_INS0_5ValueEEENS_13async_contextE,
            _ZN2v84base9TimeTicks3NowEv,
            _ZN2v86Number3NewEPNS_7IsolateEd,
            _ZNK2v86Number5ValueEv,
            _ZN2v86Number12NewFromInt32EPNS_7IsolateEi,
            _ZN2v86Number13NewFromUint32EPNS_7IsolateEj,
            _ZN2v86String11NewFromUtf8EPNS_7IsolateEPKcNS_13NewStringTypeEi,
            _ZNK2v86String9WriteUtf8EPNS_7IsolateEPciPii,
            _ZN2v812api_internal12ToLocalEmptyEv,
            _ZNK2v86String6LengthEv,
            _ZN2v88External3NewEPNS_7IsolateEPv,
            _ZNK2v88External5ValueEv,
            _ZN2v88External3NewEPNS_7IsolateEPvt,
            _ZNK2v88External5ValueEt,
            _ZN2v86Object3NewEPNS_7IsolateE,
            _ZN2v86Object3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_,
            _ZN2v86Object3SetENS_5LocalINS_7ContextEEEjNS1_INS_5ValueEEE,
            _ZN2v86Object16SetInternalFieldEiNS_5LocalINS_4DataEEE,
            _ZN2v86Object20SlowGetInternalFieldEi,
            _ZN2v86Object32SetAlignedPointerInInternalFieldEiPvt,
            _ZN2v86Object38SlowGetAlignedPointerFromInternalFieldEit,
            _ZN2v86Object3GetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEE,
            _ZN2v86Object3GetENS_5LocalINS_7ContextEEEj,
            _ZN2v811HandleScope12CreateHandleEPNS_8internal7IsolateEm,
            _ZN2v811HandleScope12CreateHandleEPNS_7IsolateEm,
            _ZN2v811HandleScope10InitializeEPNS_7IsolateE,
            _ZNK2v85Value16QuickIsUndefinedEv,
            _ZNK2v85Value11QuickIsNullEv,
            _ZNK2v85Value22QuickIsNullOrUndefinedEv,
            _ZNK2v85Value13QuickIsStringEv,
            _ZN2v811HandleScope6ExtendEPNS_7IsolateE,
            _ZN2v811HandleScope16DeleteExtensionsEPNS_7IsolateE,
            _ZN2v811HandleScopeC1EPNS_7IsolateE,
            _ZN2v811HandleScopeD1Ev,
            _ZN2v811HandleScopeD2Ev,
            _ZN2v816FunctionTemplate11GetFunctionENS_5LocalINS_7ContextEEE,
            _ZN2v816FunctionTemplate12SetClassNameENS_5LocalINS_6StringEEE,
            _ZN2v816FunctionTemplate3NewEPNS_7IsolateEPFvRKNS_20FunctionCallbackInfoINS_5ValueEEEENS_5LocalIS4_EENSA_INS_9SignatureEEEiNS_19ConstructorBehaviorENS_14SideEffectTypeEPKNS_9CFunctionEttt,
            _ZN2v814ObjectTemplate11NewInstanceENS_5LocalINS_7ContextEEE,
            _ZN2v814ObjectTemplate21SetInternalFieldCountEi,
            _ZNK2v814ObjectTemplate18InternalFieldCountEv,
            _ZN2v814ObjectTemplate3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE,
            _ZN2v816FunctionTemplate16InstanceTemplateEv,
            _ZN2v816FunctionTemplate17PrototypeTemplateEv,
            _ZN2v88Template3SetENS_5LocalINS_4NameEEENS1_INS_4DataEEENS_17PropertyAttributeE,
            _ZN2v88Template21SetNativeDataPropertyENS_5LocalINS_4NameEEEPFvS3_RKNS_20PropertyCallbackInfoINS_5ValueEEEEPFvS3_NS1_IS5_EERKNS4_IvEEESB_NS_17PropertyAttributeENS_14SideEffectTypeESI_,
            _ZN2v89Signature3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE,
            _ZN2v824EscapableHandleScopeBase10EscapeSlotEPm,
            _ZN2v824EscapableHandleScopeBaseC2EPNS_7IsolateE,
            _ZN2v88internal35IsolateFromNeverReadOnlySpaceObjectEm,
            _ZN2v85Array3NewEPNS_7IsolateEPNS_5LocalINS_5ValueEEEm,
            _ZNK2v85Array6LengthEv,
            _ZN2v85Array3NewEPNS_7IsolateEi,
            _ZN2v85Array7IterateENS_5LocalINS_7ContextEEEPFNS0_14CallbackResultEjNS1_INS_5ValueEEEPvES7_,
            _ZN2v85Array9CheckCastEPNS_5ValueE,
            _ZN2v88Function7SetNameENS_5LocalINS_6StringEEE,
            _ZN2v88Function4CallENS_5LocalINS_7ContextEEENS1_INS_5ValueEEEiPS5_,
            _ZNK2v88Function11NewInstanceENS_5LocalINS_7ContextEEEiPNS1_INS_5ValueEEE,
            _ZNK2v85Value9IsBooleanEv,
            _ZNK2v87Boolean5ValueEv,
            _ZNK2v85Value10FullIsTrueEv,
            _ZNK2v85Value11FullIsFalseEv,
            _ZN2v820EscapableHandleScopeC1EPNS_7IsolateE,
            _ZN2v820EscapableHandleScopeC2EPNS_7IsolateE,
            _ZN2v820EscapableHandleScopeD1Ev,
            _ZN2v820EscapableHandleScopeD2Ev,
            _ZNK2v85Value8IsObjectEv,
            _ZNK2v85Value8IsNumberEv,
            _ZNK2v85Value8IsUint32Ev,
            _ZNK2v85Value11Uint32ValueENS_5LocalINS_7ContextEEE,
            _ZNK2v85Value11IsUndefinedEv,
            _ZNK2v85Value6IsNullEv,
            _ZNK2v85Value17IsNullOrUndefinedEv,
            _ZNK2v85Value6IsTrueEv,
            _ZNK2v85Value7IsFalseEv,
            _ZNK2v85Value8IsStringEv,
            _ZNK2v85Value12StrictEqualsENS_5LocalIS0_EE,
            _ZN2v87Boolean3NewEPNS_7IsolateEb,
            _ZN2v811ArrayBuffer3NewEPNS_7IsolateEmNS_30BackingStoreInitializationModeE,
            _ZN2v811ArrayBuffer15GetBackingStoreEv,
            _ZNK2v812BackingStore4DataEv,
            _ZN2v815ArrayBufferView6BufferEv,
            _ZN2v815ArrayBufferView10ByteLengthEv,
            _ZN2v815ArrayBufferView10ByteOffsetEv,
            _ZN2v810Uint8Array3NewENS_5LocalINS_11ArrayBufferEEEmm,
            _ZN2v811Uint32Array3NewENS_5LocalINS_11ArrayBufferEEEmm,
            _ZN2v86Object16GetInternalFieldEi,
            _ZN2v87Context10GetIsolateEv,
            _ZN2v86String14NewFromOneByteEPNS_7IsolateEPKhNS_13NewStringTypeEi,
            _ZNK2v86String10Utf8LengthEPNS_7IsolateE,
            _ZNK2v86String10IsExternalEv,
            _ZNK2v86String17IsExternalOneByteEv,
            _ZNK2v86String17IsExternalTwoByteEv,
            _ZNK2v86String9IsOneByteEv,
            _ZNK2v86String19ContainsOnlyOneByteEv,
            _ZNK2v86String7WriteV2EPNS_7IsolateEjjPti,
            _ZNK2v86String14WriteOneByteV2EPNS_7IsolateEjjPhi,
            _ZNK2v86String11WriteUtf8V2EPNS_7IsolateEPcmiPm,
            _ZNK2v86String12Utf8LengthV2EPNS_7IsolateE,
            _ZN2v812api_internal18GlobalizeReferenceEPNS_8internal7IsolateEm,
            _ZN2v812api_internal13DisposeGlobalEPm,
            _ZN2v812api_internal8MakeWeakEPmPvPFvRKNS_16WeakCallbackInfoIvEEENS_16WeakCallbackTypeE,
            _ZN2v812api_internal9ClearWeakEPm,
            _ZN2v812api_internal19MoveGlobalReferenceEPPmS2_,
            _ZN2v812api_internal23GetFunctionTemplateDataEPNS_7IsolateENS_5LocalINS_4DataEEE,
            _ZNK2v88Function7GetNameEv,
            _ZNK2v85Value10IsFunctionEv,
            _ZNK2v85Value5IsMapEv,
            _ZNK2v85Value7IsArrayEv,
            _ZNK2v85Value7IsInt32Ev,
            _ZNK2v85Value8IsBigIntEv,
            _ZN2v812api_internal17FromJustIsNothingEv,
            _ZN2v87Integer3NewEPNS_7IsolateEi,
            _ZN2v87Integer15NewFromUnsignedEPNS_7IsolateEj,
            _ZNK2v87Integer5ValueEv,
            _ZN2v86String18NewFromUtf8LiteralEPNS_7IsolateEPKcNS_13NewStringTypeEi,
            _ZNK2v85Value12IsUint8ArrayEv,
            _ZNK2v85Value8ToStringENS_5LocalINS_7ContextEEE,
            _ZNK2v85Value9ToIntegerENS_5LocalINS_7ContextEEE,
            _ZN2v87Context6GlobalEv,
            _ZNK2v86Object18InternalFieldCountEv,
            _ZN2v86Object15GetIdentityHashEv,
            _ZN2v86Object17DefineOwnPropertyENS_5LocalINS_7ContextEEENS1_INS_4NameEEENS1_INS_5ValueEEENS_17PropertyAttributeE,
            _ZN2v820ToExternalPointerTagEt,
            _ZN2v88internal9Internals17GetCurrentIsolateEv,
            _ZN2v820HeapObjectStatisticsC1Ev,
            _ZN2v811CpuProfiler3NewEPNS_7IsolateENS_22CpuProfilingNamingModeENS_23CpuProfilingLoggingModeE,
            _ZN2v811CpuProfiler7DisposeEv,
            _ZN2v811CpuProfiler19SetSamplingIntervalEi,
            _ZN2v811CpuProfiler5StartENS_5LocalINS_6StringEEENS_16CpuProfilingModeEbj,
            _ZN2v811CpuProfiler4StopEj,
            _ZN2v811CpuProfiler14StartProfilingENS_5LocalINS_6StringEEENS_16CpuProfilingModeEbj,
            _ZN2v811CpuProfiler14StartProfilingENS_5LocalINS_6StringEEEb,
            _ZN2v811CpuProfiler13StopProfilingENS_5LocalINS_6StringEEE,
            _ZN2v810CpuProfile6DeleteEv,
            _ZNK2v810CpuProfile8GetTitleEv,
            _ZNK2v810CpuProfile10GetEndTimeEv,
            _ZNK2v810CpuProfile12GetStartTimeEv,
            _ZNK2v810CpuProfile14GetTopDownRootEv,
            _ZNK2v810CpuProfile15GetSamplesCountEv,
            _ZNK2v810CpuProfile18GetSampleTimestampEi,
            _ZNK2v810CpuProfile9GetSampleEi,
            _ZNK2v814CpuProfileNode11GetHitCountEv,
            _ZNK2v814CpuProfileNode11GetScriptIdEv,
            _ZNK2v814CpuProfileNode12GetLineTicksEPNS0_8LineTickEj,
            _ZNK2v814CpuProfileNode13GetLineNumberEv,
            _ZNK2v814CpuProfileNode15GetColumnNumberEv,
            _ZNK2v814CpuProfileNode15GetFunctionNameEv,
            _ZNK2v814CpuProfileNode15GetHitLineCountEv,
            _ZNK2v814CpuProfileNode16GetChildrenCountEv,
            _ZNK2v814CpuProfileNode18GetFunctionNameStrEv,
            _ZNK2v814CpuProfileNode21GetScriptResourceNameEv,
            _ZNK2v814CpuProfileNode8GetChildEi,
            _ZN2v83Map3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_,
            _ZN2v83Map6DeleteENS_5LocalINS_7ContextEEENS1_INS_5ValueEEE,
            uv_os_getpid,
            uv_os_getppid,
        );
    }
    #[cfg(windows)]
    {
        use v8_api::*;
        keep_symbols!(
            v8_Isolate_TryGetCurrent,
            v8_Isolate_GetCurrent,
            v8_Isolate_GetCurrentContext,
            v8_Isolate_GetEnteredOrMicrotaskContext,
            v8_Isolate_GetContinuationPreservedEmbedderData,
            v8_Isolate_IsInUse,
            v8_Isolate_LowMemoryNotification,
            v8_Isolate_AutomaticallyRestoreInitialHeapLimit,
            v8_Isolate_NumberOfTrackedHeapObjectTypes,
            v8_Isolate_GetHeapObjectStatisticsAtLastGC,
            v8_Isolate_AddGCPrologueCallback,
            v8_Isolate_RemoveGCPrologueCallback,
            v8_Isolate_AddGCEpilogueCallback,
            v8_Isolate_RemoveGCEpilogueCallback,
            v8_Isolate_AddNearHeapLimitCallback,
            v8_Isolate_RemoveNearHeapLimitCallback,
            v8_Isolate_RequestInterrupt,
            v8_Isolate_ThrowException,
            v8_Isolate_ThrowError,
            v8_Exception_Error,
            v8_Exception_TypeError,
            v8_Isolate_GetHeapProfiler,
            v8_HeapProfiler_StartSamplingHeapProfiler,
            v8_HeapProfiler_StopSamplingHeapProfiler,
            v8_HeapProfiler_GetAllocationProfile,
            node_AddEnvironmentCleanupHook,
            node_RemoveEnvironmentCleanupHook,
            node_GetCurrentEventLoop,
            node_AsyncHooksGetExecutionAsyncId,
            node_EmitAsyncInit,
            node_EmitAsyncDestroy,
            node_MakeCallback,
            v8_base_TimeTicks_Now,
            v8_Number_New,
            v8_Number_Value,
            v8_Number_NewFromInt32,
            v8_Number_NewFromUint32,
            v8_String_NewFromUtf8,
            v8_String_WriteUtf8,
            v8_api_internal_ToLocalEmpty,
            v8_String_Length,
            v8_External_New,
            v8_External_Value,
            v8_External_New_tagged,
            v8_External_Value_tagged,
            v8_Object_New,
            v8_Object_Set_key,
            v8_Object_Set_index,
            v8_Object_SetInternalField,
            v8_Object_SlowGetInternalField,
            v8_Object_SetAlignedPointerInInternalField,
            v8_Object_SlowGetAlignedPointerFromInternalField,
            v8_Object_Get_index,
            v8_Object_Get_key,
            v8_HandleScope_CreateHandle,
            v8_HandleScope_Extend,
            v8_HandleScope_DeleteExtensions,
            v8_HandleScope_ctor,
            v8_HandleScope_dtor,
            v8_FunctionTemplate_GetFunction,
            v8_FunctionTemplate_SetClassName,
            v8_FunctionTemplate_New,
            v8_ObjectTemplate_NewInstance,
            v8_ObjectTemplate_SetInternalFieldCount,
            v8_ObjectTemplate_InternalFieldCount,
            v8_ObjectTemplate_New,
            v8_FunctionTemplate_InstanceTemplate,
            v8_FunctionTemplate_PrototypeTemplate,
            v8_Template_Set,
            v8_Template_SetNativeDataProperty,
            v8_Signature_New,
            v8_EscapableHandleScopeBase_EscapeSlot,
            v8_EscapableHandleScopeBase_ctor,
            v8_internal_IsolateFromNeverReadOnlySpaceObject,
            v8_Array_New_elements,
            v8_Array_Length,
            v8_Array_New_len,
            v8_Array_New_fn,
            v8_Array_Iterate,
            v8_Array_CheckCast,
            v8_Function_SetName,
            v8_Function_Call,
            v8_Function_NewInstance,
            v8_Function_NewInstance_noargs,
            v8_Object_GetAlignedPointerFromInternalField,
            v8_Value_IsBoolean,
            v8_Boolean_Value,
            v8_Value_FullIsTrue,
            v8_Value_FullIsFalse,
            v8_EscapableHandleScope_dtor,
            v8_EscapableHandleScope_ctor,
            v8_Value_IsObject,
            v8_Value_IsNumber,
            v8_Value_IsUint32,
            v8_Value_Uint32Value,
            v8_Value_IsUndefined,
            v8_Value_IsNull,
            v8_Value_IsNullOrUndefined,
            v8_Value_IsTrue,
            v8_Value_IsFalse,
            v8_Value_IsString,
            v8_Value_StrictEquals,
            v8_Boolean_New,
            v8_Object_GetInternalField,
            v8_Context_GetIsolate,
            v8_String_NewFromOneByte,
            v8_String_IsExternal,
            v8_String_IsExternalOneByte,
            v8_String_IsExternalTwoByte,
            v8_String_IsOneByte,
            v8_String_Utf8Length,
            v8_String_ContainsOnlyOneByte,
            v8_String_WriteV2,
            v8_String_WriteOneByteV2,
            v8_String_WriteUtf8V2,
            v8_String_Utf8LengthV2,
            v8_api_internal_GlobalizeReference,
            v8_api_internal_DisposeGlobal,
            v8_api_internal_MakeWeak,
            v8_api_internal_ClearWeak,
            v8_api_internal_MoveGlobalReference,
            v8_api_internal_GetFunctionTemplateData,
            v8_Function_GetName,
            v8_Value_IsFunction,
            v8_Value_IsMap,
            v8_Value_IsArray,
            v8_Value_IsInt32,
            v8_Value_IsBigInt,
            v8_api_internal_FromJustIsNothing,
            v8_Integer_New,
            v8_Integer_NewFromUnsigned,
            v8_Integer_Value,
            v8_BigInt_New,
            v8_String_NewFromUtf8Literal,
            v8_Value_IsUint8Array,
            v8_Value_ToString,
            v8_Value_ToInteger,
            v8_Context_Global,
            v8_Object_InternalFieldCount,
            v8_Object_GetIdentityHash,
            v8_Object_DefineOwnProperty,
            v8_ToExternalPointerTag,
            v8_internal_Internals_GetCurrentIsolate,
            v8_HeapObjectStatistics_ctor,
            v8_ArrayBuffer_New,
            v8_ArrayBuffer_GetBackingStore,
            v8_BackingStore_Data,
            v8_ArrayBufferView_Buffer,
            v8_ArrayBufferView_ByteLength,
            v8_ArrayBufferView_ByteOffset,
            v8_Uint8Array_New,
            v8_Uint32Array_New,
            v8_CpuProfiler_New,
            v8_CpuProfiler_Dispose,
            v8_CpuProfiler_SetSamplingInterval,
            v8_CpuProfiler_Start,
            v8_CpuProfiler_Stop,
            v8_CpuProfiler_StartProfiling_mode,
            v8_CpuProfiler_StartProfiling,
            v8_CpuProfiler_StopProfiling,
            v8_CpuProfiler_CollectSample,
            v8_CpuProfile_Delete,
            v8_CpuProfile_GetTitle,
            v8_CpuProfile_GetEndTime,
            v8_CpuProfile_GetStartTime,
            v8_CpuProfile_GetTopDownRoot,
            v8_CpuProfile_GetSamplesCount,
            v8_CpuProfile_GetSampleTimestamp,
            v8_CpuProfile_GetSample,
            v8_CpuProfileNode_GetHitCount,
            v8_CpuProfileNode_GetScriptId,
            v8_CpuProfileNode_GetLineTicks,
            v8_CpuProfileNode_GetLineNumber,
            v8_CpuProfileNode_GetColumnNumber,
            v8_CpuProfileNode_GetFunctionName,
            v8_CpuProfileNode_GetHitLineCount,
            v8_CpuProfileNode_GetChildrenCount,
            v8_CpuProfileNode_GetFunctionNameStr,
            v8_CpuProfileNode_GetScriptResourceName,
            v8_CpuProfileNode_GetChild,
            v8_Map_Set,
            v8_Map_Delete,
        );
    }
    #[cfg(all(not(windows), target_os = "android"))]
    keep_symbols!(
        posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt6__ndk18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE,
        posix_platform_specific_v8_apis::_ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt6__ndk18optionalImEE,
        posix_platform_specific_v8_apis::_ZN2v86BigInt3NewEPNS_7IsolateEl,
        posix_platform_specific_v8_apis::_ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE,
    );
    #[cfg(all(not(windows), target_os = "macos"))]
    keep_symbols!(
        posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt3__18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE,
        posix_platform_specific_v8_apis::_ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt3__18optionalIyEE,
        posix_platform_specific_v8_apis::_ZN2v86BigInt3NewEPNS_7IsolateEx,
        posix_platform_specific_v8_apis::_ZN2v812HeapProfiler25StartSamplingHeapProfilerEyiNS0_13SamplingFlagsE,
    );
    #[cfg(all(not(windows), target_os = "freebsd"))]
    keep_symbols!(
        posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt3__18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE,
        posix_platform_specific_v8_apis::_ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt3__18optionalImEE,
        posix_platform_specific_v8_apis::_ZN2v86BigInt3NewEPNS_7IsolateEl,
        posix_platform_specific_v8_apis::_ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE,
    );
    #[cfg(all(
        not(windows),
        not(target_os = "android"),
        not(target_os = "macos"),
        not(target_os = "freebsd")
    ))]
    keep_symbols!(
        posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmSt8functionIFNS_10MaybeLocalINS_5ValueEEEvEE,
        posix_platform_specific_v8_apis::_ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateESt8optionalImE,
        posix_platform_specific_v8_apis::_ZN2v86BigInt3NewEPNS_7IsolateEl,
        posix_platform_specific_v8_apis::_ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE,
    );
}
