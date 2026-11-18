//! The cells that a realm has one of. The standard library makes the eager ones with the realm and each of the others
//! when it is first asked for. One with an `@name` is what that name means in the source of a built-in.

use bun_engine_bytecode::LinkTimeConstant;
use bun_engine_text::{PropertyName, private_names};

use crate::{
    Cx, Gc, GetterSetter, GlobalObject, GlobalProxy, InternalFieldTuple, JsCallee, JsCell,
    JsFunction, JsObject, JsSymbol, ModuleLoader, Shape, Vm,
};

macro_rules! realm_slots {
    (
        eager { $($eager:ident: $eager_type:ty $(= @$eager_name:ident)?,)* }
        lazy { $($lazy:ident: $lazy_type:ty $(= @$lazy_name:ident)?,)* }
    ) => {
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(u16)]
        #[allow(non_camel_case_types)]
        pub enum RealmSlot {
            $($eager,)*
            $($lazy,)*
        }

        impl RealmSlot {
            pub const ALL: [RealmSlot; Self::COUNT] = [$(RealmSlot::$eager,)* $(RealmSlot::$lazy,)*];
            pub const COUNT: usize = [$(stringify!($eager),)* $(stringify!($lazy),)*].len();
            pub(crate) const PRIVATE_NAMES: &[(PropertyName<'static>, RealmSlot)] = &[
                $($((private_names::$eager_name, RealmSlot::$eager),)?)*
                $($((private_names::$lazy_name, RealmSlot::$lazy),)?)*
            ];
        }

        impl GlobalObject {
            $(
                #[inline(always)]
                pub fn $eager(&self) -> Gc<$eager_type> {
                    // SAFETY: only the setter stores there.
                    unsafe { self.eager_slot(RealmSlot::$eager).cast_unchecked() }
                }

                pub fn ${concat(init_, $eager)}(&self, value: Gc<$eager_type>) {
                    self.slots().set(RealmSlot::$eager as usize, Some(value.cell()));
                }
            )*
            $(
                #[inline(always)]
                pub fn $lazy(&self, vm: &Vm) -> Gc<$lazy_type> {
                    // SAFETY: only the setter stores there.
                    unsafe { self.slot(vm, RealmSlot::$lazy).cast_unchecked() }
                }

                pub fn ${concat(init_, $lazy)}(&self, value: Gc<$lazy_type>) {
                    self.slots().set(RealmSlot::$lazy as usize, Some(value.cell()));
                }
            )*
        }

        impl Cx {
            $(
                #[inline(always)]
                pub fn $eager(&self) -> Gc<$eager_type> {
                    self.global().$eager()
                }
            )*
            $(
                #[inline(always)]
                pub fn $lazy(&self) -> Gc<$lazy_type> {
                    self.global().$lazy(self)
                }
            )*
        }
    };
}

realm_slots! {
    eager {
        global_this: GlobalProxy,
        async_context: InternalFieldTuple = @asyncContext,
        object_prototype: JsObject,
        function_prototype: JsObject,
        array_prototype: JsObject,
        string_prototype: JsObject,
        iterator_prototype: JsObject,
        array_iterator_prototype: JsObject,
        array_prototype_values: JsFunction,
        object_shape: Shape,
        null_prototype_object_shape: Shape,
        function_shape: Shape,
        method_shape: Shape,
        builtin_function_shape: Shape,
        native_function_shape: Shape,
        callee_shape: Shape,
        environment_shape: Shape,
        module_environment_shape: Shape,
        with_scope_shape: Shape,
    }
    lazy {
        // Objects and functions
        object_constructor: JsObject = @Object,
        object_prototype_has_own_property: JsFunction = @hasOwnPropertyFunction,
        object_prototype_to_string: JsFunction,
        object_prototype_value_of: JsFunction,
        data_descriptor_shape: Shape,
        accessor_descriptor_shape: Shape,
        function_constructor: JsObject,
        function_prototype_call: JsFunction = @callFunction,
        function_prototype_apply: JsFunction = @applyFunction,
        function_prototype_has_instance: JsFunction,
        throw_type_error_function: JsFunction,
        throw_type_error_accessor: GetterSetter,
        absent_callee: JsCallee,
        bound_function_shape: Shape,
        custom_getter_function_shape: Shape,
        custom_setter_function_shape: Shape,
        native_closure_shape: Shape,
        direct_arguments_shape: Shape,
        scoped_arguments_shape: Shape,
        cloned_arguments_shape: Shape,
        reflect_object: JsObject,
        reflect_construct: JsFunction = @reflectConstructFunction,
        proxy_constructor: JsObject,
        proxy_shape: Shape,
        callable_proxy_shape: Shape,
        revocable_proxy_shape: Shape,
        internal_field_tuple_shape: Shape,

        // Functions of the global object
        eval_function: JsFunction = @evalFunction,
        is_nan_function: JsFunction,
        is_finite_function: JsFunction = @isFinite,
        escape_function: JsFunction,
        unescape_function: JsFunction,
        decode_uri_function: JsFunction,
        decode_uri_component_function: JsFunction,
        encode_uri_function: JsFunction,
        encode_uri_component_function: JsFunction,
        parse_int_function: JsFunction,
        parse_float_function: JsFunction,

        // Primitives
        string_constructor: JsObject = @String,
        string_object_shape: Shape,
        string_prototype_iterator: JsFunction,
        string_prototype_trim_start: JsFunction,
        string_prototype_trim_end: JsFunction,
        string_iterator_prototype: JsObject,
        string_iterator_shape: Shape,
        number_prototype: JsObject,
        number_constructor: JsObject = @Number,
        number_object_shape: Shape,
        boolean_prototype: JsObject,
        boolean_constructor: JsObject,
        boolean_object_shape: Shape,
        symbol_prototype: JsObject,
        symbol_constructor: JsObject,
        symbol_object_shape: Shape,
        bigint_prototype: JsObject,
        bigint_constructor: JsObject,
        bigint_object_shape: Shape,
        math_object: JsObject,
        json_object: JsObject,
        raw_json_shape: Shape,
        date_prototype: JsObject,
        date_constructor: JsObject,
        date_shape: Shape,
        console_object: JsObject,

        // Errors, in the order of `ErrorType`
        error_shape: Shape,
        eval_error_shape: Shape,
        range_error_shape: Shape,
        reference_error_shape: Shape,
        syntax_error_shape: Shape,
        type_error_shape: Shape,
        uri_error_shape: Shape,
        aggregate_error_shape: Shape,
        suppressed_error_shape: Shape,
        error_constructor: JsObject,
        eval_error_constructor: JsObject,
        range_error_constructor: JsObject,
        reference_error_constructor: JsObject = @ReferenceError,
        syntax_error_constructor: JsObject,
        type_error_constructor: JsObject,
        uri_error_constructor: JsObject,
        aggregate_error_constructor: JsObject = @AggregateError,
        suppressed_error_constructor: JsObject = @SuppressedError,
        error_prototype: JsObject,

        // Arrays and iteration
        array_constructor: JsObject = @Array,
        array_prototype_to_string: JsFunction,
        array_iterator_shape: Shape,
        iterator_constructor: JsObject = @Iterator,
        iterator_prototype_iterator: JsFunction = @iteratorPrototypeSymbolIterator,
        iterator_shape: Shape,
        iterator_result_shape: Shape,
        iterator_helper_prototype: JsObject,
        iterator_helper_shape: Shape,
        wrap_for_valid_iterator_shape: Shape,
        async_iterator_prototype: JsObject,
        async_from_sync_iterator_shape: Shape,

        // Regular expressions
        regexp_prototype: JsObject,
        regexp_constructor: JsObject = @RegExp,
        regexp_shape: Shape,
        regexp_prototype_exec: JsFunction = @regExpBuiltinExec,
        regexp_match_array_shape: Shape,
        regexp_match_array_with_indices_shape: Shape,
        regexp_indices_array_shape: Shape,
        regexp_string_iterator_shape: Shape,

        // Collections
        map_prototype: JsObject,
        map_constructor: JsObject = @Map,
        map_shape: Shape,
        map_prototype_entries: JsFunction,
        map_iterator_prototype: JsObject,
        map_iterator_shape: Shape,
        set_prototype: JsObject,
        set_constructor: JsObject = @Set,
        set_shape: Shape,
        set_prototype_values: JsFunction,
        set_iterator_prototype: JsObject,
        set_iterator_shape: Shape,
        weak_map_constructor: JsObject,
        weak_map_shape: Shape,
        weak_set_constructor: JsObject,
        weak_set_shape: Shape,
        weak_ref_constructor: JsObject,
        weak_ref_shape: Shape,
        finalization_registry_constructor: JsObject,
        finalization_registry_shape: Shape,

        // Promises, generators and resources
        promise_prototype: JsObject,
        promise_constructor: JsObject = @Promise,
        promise_shape: Shape,
        promise_prototype_then: JsFunction = @defaultPromiseThen,
        promise_capability_shape: Shape,
        fulfilled_outcome_shape: Shape,
        rejected_outcome_shape: Shape,
        function_with_fields_shape: Shape,
        generator_function_prototype: JsObject,
        generator_function_shape: Shape,
        generator_prototype: JsObject,
        generator_shape: Shape,
        async_function_prototype: JsObject,
        async_function_shape: Shape,
        async_function_generator_shape: Shape,
        async_generator_function_prototype: JsObject,
        async_generator_function_shape: Shape,
        async_generator_prototype: JsObject,
        async_generator_shape: Shape,
        async_generator_prototype_next: JsFunction,
        async_iterator_prototype_async_iterator: JsFunction,
        disposable_stack_constructor: JsObject = @DisposableStack,
        disposable_stack_shape: Shape,
        disposable_stack_prototype_dispose: JsFunction,
        async_disposable_stack_constructor: JsObject = @AsyncDisposableStack,
        async_disposable_stack_shape: Shape,
        async_disposable_stack_prototype_dispose: JsFunction,
        shadow_realm_constructor: JsObject = @ShadowRealm,
        shadow_realm_shape: Shape,
        remote_function_shape: Shape,
        ffi_function_shape: Shape,
        ffi_callback_shape: Shape,
        open_ffi_callbacks: JsCell,

        // Binary data. The runs are in the order of the cell types.
        array_buffer_prototype: JsObject,
        array_buffer_constructor: JsObject = @ArrayBuffer,
        array_buffer_shape: Shape,
        shared_array_buffer_prototype: JsObject,
        shared_array_buffer_constructor: JsObject,
        shared_array_buffer_shape: Shape,
        atomics_object: JsObject,
        typed_array_prototype: JsObject,
        typed_array_prototype_values: JsFunction,
        typed_array_constructor: JsObject,
        int8_array_constructor: JsObject = @Int8Array,
        uint8_array_constructor: JsObject = @Uint8Array,
        uint8_clamped_array_constructor: JsObject = @Uint8ClampedArray,
        int16_array_constructor: JsObject = @Int16Array,
        uint16_array_constructor: JsObject = @Uint16Array,
        int32_array_constructor: JsObject = @Int32Array,
        uint32_array_constructor: JsObject = @Uint32Array,
        float16_array_constructor: JsObject = @Float16Array,
        float32_array_constructor: JsObject = @Float32Array,
        float64_array_constructor: JsObject = @Float64Array,
        bigint64_array_constructor: JsObject = @BigInt64Array,
        biguint64_array_constructor: JsObject = @BigUint64Array,
        data_view_constructor: JsObject,
        int8_array_shape: Shape,
        uint8_array_shape: Shape,
        uint8_clamped_array_shape: Shape,
        int16_array_shape: Shape,
        uint16_array_shape: Shape,
        int32_array_shape: Shape,
        uint32_array_shape: Shape,
        float16_array_shape: Shape,
        float32_array_shape: Shape,
        float64_array_shape: Shape,
        bigint64_array_shape: Shape,
        biguint64_array_shape: Shape,
        data_view_shape: Shape,
        resizable_int8_array_shape: Shape,
        resizable_uint8_array_shape: Shape,
        resizable_uint8_clamped_array_shape: Shape,
        resizable_int16_array_shape: Shape,
        resizable_uint16_array_shape: Shape,
        resizable_int32_array_shape: Shape,
        resizable_uint32_array_shape: Shape,
        resizable_float16_array_shape: Shape,
        resizable_float32_array_shape: Shape,
        resizable_float64_array_shape: Shape,
        resizable_bigint64_array_shape: Shape,
        resizable_biguint64_array_shape: Shape,
        resizable_data_view_shape: Shape,
        decoding_result_shape: Shape,

        // Modules
        module_loader: ModuleLoader = @moduleLoader,
        module_record_shape: Shape,
        synthetic_module_record_shape: Shape,
        module_namespace_shape: Shape,

        // Namespaces that other crates fill
        intl_object: JsObject,
        temporal_object: JsObject,
        temporal_now_object: JsObject,
        temporal_zone_names: JsCell,
        temporal_duration_constructor: JsObject,
        temporal_duration_shape: Shape,
        temporal_instant_constructor: JsObject,
        temporal_instant_shape: Shape,
        temporal_plain_date_constructor: JsObject,
        temporal_plain_date_shape: Shape,
        temporal_plain_date_time_constructor: JsObject,
        temporal_plain_date_time_shape: Shape,
        temporal_plain_month_day_constructor: JsObject,
        temporal_plain_month_day_shape: Shape,
        temporal_plain_time_constructor: JsObject,
        temporal_plain_time_shape: Shape,
        temporal_plain_year_month_constructor: JsObject,
        temporal_plain_year_month_shape: Shape,
        temporal_zoned_date_time_constructor: JsObject,
        temporal_zoned_date_time_shape: Shape,
        webassembly_object: JsObject,

        // Intl
        intl_state: JsCell,
        intl_fallback_symbol: JsSymbol,
        intl_part_shape: Shape,
        intl_part_with_unit_shape: Shape,
        intl_part_with_source_shape: Shape,
        collator_constructor: JsObject,
        collator_shape: Shape,
        date_time_format_constructor: JsObject,
        date_time_format_shape: Shape,
        display_names_constructor: JsObject,
        display_names_shape: Shape,
        duration_format_constructor: JsObject,
        duration_format_shape: Shape,
        list_format_constructor: JsObject,
        list_format_shape: Shape,
        locale_constructor: JsObject,
        locale_shape: Shape,
        number_format_constructor: JsObject,
        number_format_shape: Shape,
        plural_rules_constructor: JsObject,
        plural_rules_shape: Shape,
        relative_time_format_constructor: JsObject,
        relative_time_format_shape: Shape,
        segmenter_constructor: JsObject,
        segmenter_shape: Shape,
        segments_shape: Shape,
        segment_iterator_shape: Shape,
        segment_data_shape: Shape,
        word_segment_data_shape: Shape,

        // Only for built-ins
        private_proxy_get: JsFunction = @proxyGet,
        private_proxy_handler: JsFunction = @proxyHandler,
        private_proxy_has: JsFunction = @proxyHas,
        private_proxy_set: JsFunction = @proxySet,
        private_validate_proxy_get: JsFunction = @handleProxyGetTrapResult,
        private_validate_proxy_has: JsFunction = @handleNegativeProxyHasTrapResult,
        private_validate_proxy_set: JsFunction = @handlePositiveProxySetTrapResult,
        private_throw_falsy_proxy_set: JsFunction = @throwFalsyProxySetTrapResult,
        private_is_array: JsFunction = @isArray,
        private_array_from_fast: JsFunction = @arrayFromFastWithoutMapFn,
        private_array_from_async_iterator: JsFunction = @arrayFromAsyncIterator,
        private_array_from_async_array_like: JsFunction = @arrayFromAsyncArrayLike,
        private_array_iterator_step: JsFunction = @arrayIteratorStep,
        private_collect_for_spread: JsFunction = @collectForSpread,
        private_flat_into_array: JsFunction = @flatIntoArray,
        private_iterator_helper_create: JsFunction = @iteratorHelperCreate,
        private_wrap_for_valid_iterator_create: JsFunction = @wrapForValidIteratorCreate,
        private_is_iterator_instance: JsFunction = @isIteratorInstance,
        private_own_keys: JsFunction = @ownKeys,
        private_get_iterator_flattenable: JsFunction = @getIteratorFlattenable,
        private_close_iterator_quietly: JsFunction = @closeIteratorQuietly,
        private_close_iterators: JsFunction = @closeIterators,
        private_close_iterators_quietly: JsFunction = @closeIteratorsQuietly,
        private_iterator_limit: JsFunction = @iteratorLimit,
        private_check_chunk_size: JsFunction = @checkChunkSize,
        private_mapped_values: JsFunction = @mappedValues,
        private_filtered_values: JsFunction = @filteredValues,
        private_taken_values: JsFunction = @takenValues,
        private_remaining_values: JsFunction = @remainingValues,
        private_flat_mapped_values: JsFunction = @flatMappedValues,
        private_chunked_values: JsFunction = @chunkedValues,
        private_windowed_values: JsFunction = @windowedValues,
        private_concatenated_values: JsFunction = @concatenatedValues,
        private_zipped_values: JsFunction = @zippedValues,
        private_zip_options: JsFunction = @zipOptions,
        private_zip_iterators: JsFunction = @zipIterators,
        private_is_iteration_pristine: JsFunction = @isIterationPristine,
        private_map_storage: JsFunction = @mapStorage,
        private_map_iteration_next: JsFunction = @mapIterationNext,
        private_map_iteration_entry: JsFunction = @mapIterationEntry,
        private_map_iteration_entry_key: JsFunction = @mapIterationEntryKey,
        private_map_iteration_entry_value: JsFunction = @mapIterationEntryValue,
        private_set_storage: JsFunction = @setStorage,
        private_set_iteration_next: JsFunction = @setIterationNext,
        private_set_iteration_entry: JsFunction = @setIterationEntry,
        private_set_iteration_entry_key: JsFunction = @setIterationEntryKey,
        private_is_typed_array_view: JsFunction = @isTypedArrayView,
        private_is_detached: JsFunction = @isDetached,
        private_typed_array_length: JsFunction = @typedArrayLength,
        private_typed_array_from_fast: JsFunction = @typedArrayFromFast,
        private_typed_array_species_create: JsFunction = @typedArraySpeciesCreate,
        private_json_parse: JsFunction = @jsonParse,
        private_make_type_error: JsFunction = @makeTypeError,
        private_min: JsFunction = @min,
        private_to_length: JsFunction = @toLength,
        private_to_integer_or_infinity: JsFunction = @toIntegerOrInfinity,
        private_resolve_promise: JsFunction = @resolvePromise,
        private_reject_promise: JsFunction = @rejectPromise,
        private_resolve_promise_once: JsFunction = @resolvePromiseWithFirstResolvingFunctionCallCheck,
        private_reject_promise_once: JsFunction = @rejectPromiseWithFirstResolvingFunctionCallCheck,
        private_perform_promise_then: JsFunction = @performPromiseThen,
        private_promise_resolve: JsFunction = @promiseResolve,
        private_promise_reject: JsFunction = @promiseReject,
        private_generator_resume: JsFunction = @generatorResume,
        private_async_from_sync_iterator_create: JsFunction = @asyncFromSyncIteratorCreate,
        private_dispose_async_stack: JsFunction = @disposeAsyncStack,
    }
}

impl RealmSlot {
    const OF_GENERATOR: [RealmSlot; LinkTimeConstant::FIRST_OF_HOST.0 as usize] = [
        RealmSlot::function_prototype_call,
        RealmSlot::function_prototype_apply,
        RealmSlot::object_prototype_has_own_property,
        RealmSlot::reflect_construct,
        RealmSlot::eval_function,
        RealmSlot::object_constructor,
        RealmSlot::array_constructor,
    ];

    /// Panics if there is none.
    #[inline]
    pub const fn from_index(index: usize) -> RealmSlot {
        Self::ALL[index]
    }

    /// The one that is `distance` further on in the list.
    #[inline]
    pub const fn offset_by(self, distance: usize) -> RealmSlot {
        Self::from_index(self as usize + distance)
    }

    pub fn for_constant(constant: LinkTimeConstant) -> RealmSlot {
        match constant.0.checked_sub(LinkTimeConstant::FIRST_OF_HOST.0) {
            Some(index) => Self::from_index(index.into()),
            None => Self::OF_GENERATOR[usize::from(constant.0)],
        }
    }

    pub fn as_constant(self) -> LinkTimeConstant {
        LinkTimeConstant(LinkTimeConstant::FIRST_OF_HOST.0 + self as u16)
    }
}

impl GlobalObject {
    #[inline(always)]
    fn eager_slot(&self, slot: RealmSlot) -> Gc<JsCell> {
        self.slots()
            .at(slot as usize)
            .expect("set when the realm is made")
    }

    #[inline(always)]
    pub fn slot(&self, vm: &Vm, slot: RealmSlot) -> Gc<JsCell> {
        match self.slots().at(slot as usize) {
            Some(cell) => cell,
            None => self.initialize_slot(vm, slot),
        }
    }

    #[inline(always)]
    pub fn slot_if_initialized(&self, slot: RealmSlot) -> Option<Gc<JsCell>> {
        self.slots().at(slot as usize)
    }

    #[cold]
    #[inline(never)]
    fn initialize_slot(&self, vm: &Vm, slot: RealmSlot) -> Gc<JsCell> {
        #[cfg(debug_assertions)]
        crate::direct::will_extend_realm();
        // SAFETY: the `Vm` is borrowed from the one that is in use, and the hook gets no more than a shared borrow.
        let cx: &Cx = unsafe { Cx::from_global(self.into()) };
        (vm.hooks().initialize_realm_slot)(cx, slot);
        self.slot_if_initialized(slot)
            .unwrap_or_else(|| panic!("nothing makes {slot:?}"))
    }
}
