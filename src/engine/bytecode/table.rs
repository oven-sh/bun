//! The instruction set.
//!
//! An entry is `Name mnemonic Flow { operand: Shape, .. } => MetadataKind;`. What holds for all of them:
//!
//! - Every operand is read before any is written, so a destination may be a source too.
//! - An instruction that throws has written no register.
//! - An instruction either completes or can be run again from its start.
//! - "Empty" is the absence of a value. Only the operands that say so can hold it.

/// Hands the table to a macro.
#[macro_export]
macro_rules! instruction_table {
    ($callback:ident) => { $callback! {
        /// The operands of the next instruction take two bytes.
        Wide16Prefix wide16_prefix Pure {};
        /// The operands and the metadata offset of the next instruction take four bytes.
        Wide32Prefix wide32_prefix Pure {};

        // Frames

        /// Local 0 becomes the scope of the callee, locals 1 to `variables` become undefined.
        Enter enter Pure { variables: Variables };
        Move mov Pure { dst: Dst, src: Src };
        /// The head of a loop: counts towards the next tier, is where it is entered, and polls for interrupts.
        LoopHint loop_hint Pure {};
        Return ret Ends { value: Src };
        /// The `this` of a function that is not strict.
        ToThis to_this Throws { this: Mut } => ToThis;
        CreateThis create_this Throws { dst: Dst, new_target: Reg, capacity: Unsigned } => CachedCallee;
        /// Throws if `value` is empty: the binding `name` is not initialized.
        CheckInitialized check_initialized Throws { value: Reg, name: Name };
        /// Throws if `this` is empty: `super()` has not returned.
        CheckThis check_this Throws { this: Reg };
        /// Throws unless `this` is empty.
        BindThis bind_this Throws { this: Mut, value: Reg };

        // Arguments

        /// Without `this`.
        ArgumentCount argument_count Pure { dst: Dst };
        /// Undefined if the caller passed fewer.
        GetArgument get_argument Pure { dst: Dst, index: Unsigned } => Value;
        CreateRest create_rest Throws { dst: Dst, skip: Unsigned };
        /// Holds the parameters itself, as many as the code has.
        CreateDirectArguments create_direct_arguments Throws { dst: Dst };
        /// Maps to the first `StaticScope::mapped_parameters` slots of `scope`.
        CreateScopedArguments create_scoped_arguments Throws { dst: Dst, scope: Reg };
        CreateUnmappedArguments create_unmapped_arguments Throws { dst: Dst };
        GetFromArguments get_from_arguments Pure { dst: Dst, arguments: Reg, index: Parameter } => Value;
        PutToArguments put_to_arguments Pure { arguments: Reg, index: Parameter, value: Src };
        /// `arguments` is empty until something needs the object. Until then the frame has the values.
        EnsureArguments ensure_arguments Throws { arguments: Mut, mapped: Flag };
        /// The same for a rest parameter.
        EnsureRest ensure_rest Throws { rest: Mut, skip: Unsigned };
        /// `arguments.length`. For these three it is either of those, and stands for all but the first `skip` if empty.
        GetArgumentsLength get_arguments_length Throws { dst: Dst, arguments: Reg, skip: Unsigned } => Value;
        /// `arguments[key]`, if `arguments` is empty and `key` is the index of an argument: then it jumps.
        GetArgumentByVal get_argument_by_val Pure { dst: DstIfJumps, arguments: Reg, key: Src, skip: Unsigned, done: Target } => Value;
        /// `spread`, if `arguments` is empty and no script could tell: then it jumps. Empty if it is `for_call`.
        SpreadArguments spread_arguments Throws { dst: DstIfJumps, arguments: Reg, skip: Unsigned, for_call: Flag, done: Target };

        // Scopes

        /// The first `StaticScope::undefined_slots` slots are undefined, the others empty.
        CreateScope create_scope Throws { dst: Dst, parent: Reg, scope: Scope };
        /// A copy with the same parent, for the next turn of a loop.
        CopyScope copy_scope Throws { scope: Mut };
        CreateWithScope create_with_scope Throws { dst: Dst, parent: Reg, scope: Scope, object: Src };
        GetScoped get_scoped Pure { dst: Dst, scope: Reg, slot: Unsigned } => Value;
        /// `depth` parents up from `scope`.
        GetOuter get_outer Pure { dst: Dst, scope: Reg, depth: Unsigned, slot: Unsigned } => Value;
        /// If the slot is empty, its binding says what happens: a function or `import.meta` is created and
        /// stored, anything else throws.
        GetScopedChecked get_scoped_checked Throws { dst: Dst, scope: Reg, slot: Unsigned } => Value;
        GetOuterChecked get_outer_checked Throws { dst: Dst, scope: Reg, depth: Unsigned, slot: Unsigned } => Value;
        /// For what scripts cannot name: private names, brands, home objects, `this`. May be empty.
        GetInternal get_internal Pure { dst: Dst, scope: Reg, depth: Unsigned, slot: Unsigned };
        PutScoped put_scoped Pure { scope: Reg, slot: Unsigned, value: Src };
        PutOuter put_outer Pure { scope: Reg, depth: Unsigned, slot: Unsigned, value: Src };
        /// `depth` parents up is the module. `slot` is the first of the two that it reserves for the import.
        GetImport get_import Throws { dst: Dst, scope: Reg, depth: Unsigned, slot: Unsigned } => GetImport;
        GetGlobal get_global Throws { dst: Dst, name: Name, unresolved: Unresolved } => GetGlobal;
        PutGlobal put_global Throws { name: Name, value: Src, strict: Flag } => PutGlobal;
        /// For `let`, `const` and `class` at the top level of a script.
        InitializeGlobal initialize_global Throws { name: Name, value: Src };
        DeleteGlobal delete_global Throws { dst: Dst, name: Name };
        /// The scope that binds `name`, or the global one: when `with` or a variable of `eval` may be in the way.
        ResolveDynamic resolve_dynamic Throws { dst: Dst, scope: Reg, name: Name } => ResolveDynamic;
        GetDynamic get_dynamic Throws { dst: Dst, holder: Reg, name: Name, unresolved: Unresolved, strict: Flag } => GetDynamic;
        PutDynamic put_dynamic Throws { holder: Reg, name: Name, value: Src, strict: Flag } => PutDynamic;
        DeleteDynamic delete_dynamic Throws { dst: Dst, holder: Reg, name: Name };
        /// WithBaseObject of ECMA-262.
        GetDynamicThis get_dynamic_this Pure { dst: Dst, holder: Reg };
        /// Stores a function of a script or of `eval` code in the variable scope around `scope`, unless a lexical
        /// binding of that name is in the way (ECMA-262 B.3.2.2, B.3.2.3).
        PutHoisted put_hoisted Throws { scope: Reg, name: Name, value: Reg };

        // Properties

        GetById get_by_id Throws { dst: Dst, base: Src, name: Name } => GetById;
        GetLength get_length Throws { dst: Dst, base: Src } => GetLength;
        /// An own property, or undefined.
        GetByIdDirect get_by_id_direct Throws { dst: Dst, base: Src, name: Name } => GetByIdDirect;
        GetByIdWithThis get_by_id_with_this Throws { dst: Dst, base: Reg, this: Src, name: Name } => LazyCacheAndValue;
        GetByVal get_by_val Throws { dst: Dst, base: Src, key: Src } => GetByVal;
        GetByValWithThis get_by_val_with_this Throws { dst: Dst, base: Src, this: Src, key: Src } => GetByVal;
        PutById put_by_id Throws { base: Src, name: Name, value: Src, flags: PutFlags } => PutById;
        PutByIdWithThis put_by_id_with_this Throws { base: Reg, this: Src, name: Name, value: Src, strict: Flag };
        PutByVal put_by_val Throws { base: Src, key: Src, value: Src, strict: Flag } => ArrayAccess;
        /// CreateDataProperty.
        PutByValDirect put_by_val_direct Throws { base: Src, key: Src, value: Src, strict: Flag } => ArrayAccess;
        PutByValWithThis put_by_val_with_this Throws { base: Src, this: Src, key: Src, value: Src, strict: Flag };
        DeleteById delete_by_id Throws { dst: Dst, base: Src, name: Name, strict: Flag } => LazyCache;
        DeleteByVal delete_by_val Throws { dst: Dst, base: Src, key: Src, strict: Flag } => LazyCache;
        InById in_by_id Throws { dst: Dst, base: Src, name: Name } => LazyCache;
        InByVal in_by_val Throws { dst: Dst, base: Src, key: Src } => ArrayAccess;
        GetPrototypeOf get_prototype_of Throws { dst: Dst, value: Src } => Value;
        /// `__proto__: value` in a literal. Does nothing unless the value is an object or null.
        SetPrototype set_prototype Throws { object: Reg, prototype: Src } => SetPrototype;
        /// Writable and configurable. `key` is a property key or a number.
        DefineMethod define_method Throws { object: Reg, key: Src, function: Reg, flags: DefineFlags };
        DefineAccessor define_accessor Throws { object: Reg, key: Src, getter: Src, setter: Src, flags: DefineFlags };
        SetFunctionName set_function_name Throws { function: Reg, name: Src };
        CopyDataProperties copy_data_properties Throws { target: Reg, source: Src };
        /// `{ ...source }`
        CloneObject clone_object Throws { dst: Dst, source: Src } => Value;
        /// The rest element of an object pattern: all but `excluded` and the `count` keys from `first` on.
        CopyRest copy_rest Throws { dst: Dst, source: Src, excluded: Names, first: First, count: Count };
        /// `constructor[Symbol.hasInstance]`. Throws unless `constructor` is an object.
        GetHasInstance get_has_instance Throws { dst: Dst, constructor: Src } => GetById;
        /// Does nothing if the answer is whether `constructor.prototype` is on the prototype chain of `value`.
        /// Otherwise finds the answer and jumps.
        InstanceofCustom instanceof_custom Throws { dst: DstIfJumps, value: Src, constructor: Src, has_instance: Reg, done: Target } => Branch;
        Instanceof instanceof Throws { dst: Dst, value: Src, prototype: Reg } => LazyCache;
        GetInternalField get_internal_field Pure { dst: Dst, base: Src, index: Unsigned } => Value;
        PutInternalField put_internal_field Pure { base: Src, index: Unsigned, value: Src };

        // Private names

        CreatePrivateName create_private_name Throws { dst: Dst, description: Name };
        GetPrivateName get_private_name Throws { dst: Dst, base: Src, name: Reg } => GetPrivateName;
        PutPrivateName put_private_name Throws { base: Src, name: Reg, value: Src } => PutPrivateName;
        DefinePrivateName define_private_name Throws { base: Reg, name: Reg, value: Src } => PutPrivateName;
        HasPrivateName has_private_name Throws { dst: Dst, base: Src, name: Reg } => LazyCache;
        SetPrivateBrand set_private_brand Throws { base: Reg, brand: Reg } => PrivateBrand;
        CheckPrivateBrand check_private_brand Throws { base: Src, brand: Reg } => PrivateBrand;
        HasPrivateBrand has_private_brand Throws { dst: Dst, base: Src, brand: Reg } => LazyCache;

        // Allocation

        NewObject new_object Throws { dst: Dst, capacity: Unsigned } => NewObject;
        /// One data property for each of `names`, which are distinct and no indices.
        NewObjectLiteral new_object_literal Throws { dst: Dst, names: Names, first: First, count: Count, capacity: Unsigned } => NewObject;
        /// An empty element is a hole.
        NewArray new_array Throws { dst: Dst, first: First, count: Count, shape: ArrayShape } => NewArray;
        /// Shares the elements of the constant until it is written to.
        NewArrayFromConstant new_array_from_constant Throws { dst: Dst, elements: ArrayConstant } => NewArray;
        /// `new Array(length)`
        NewArrayWithSize new_array_with_size Throws { dst: Dst, length: Src } => NewArray;
        /// ArraySpeciesCreate.
        NewArrayWithSpecies new_array_with_species Throws { dst: Dst, length: Src, array: Src } => NewArrayWithSpecies;
        /// The elements that `mask` selects are lists made by `spread`.
        NewArrayWithSpread new_array_with_spread Throws { dst: Dst, first: First, count: Count, mask: SpreadMask };
        /// The next elements of a long literal.
        AppendToArray append_to_array Throws { array: Reg, first: First, count: Count, mask: SpreadMask };
        /// An immutable list of what `iterable` yields. Scripts never see it.
        Spread spread Throws { dst: Dst, iterable: Src };
        /// CreateListFromArrayLike for `apply`: `value` itself if it is empty, undefined, null or can be read
        /// without running code, a list otherwise.
        ToArgumentList to_argument_list Throws { dst: Dst, value: Src };
        NewRegExp new_reg_exp Throws { dst: Dst, regexp: RegExpConstant };
        /// The receiver of `/x/.test(..)` or `/x/.exec(..)`: one object serves while those two are pristine.
        NewSharedRegExp new_shared_reg_exp Throws { dst: Dst, regexp: RegExpConstant, for_test: Flag } => SharedRegExp;
        NewFunction new_function Throws { dst: Dst, scope: Reg, function: Function };
        /// Links the constructor, the prototype and their parents. `heritage` is empty without `extends`; `name` is
        /// empty unless it was computed.
        NewClass new_class Throws { constructor: Dst, prototype: Dst, scope: Reg, function: Function, heritage: Src, name: Src };
        NewPromise new_promise Throws { dst: Dst };
        CreatePromise create_promise Throws { dst: Dst, new_target: Src } => CachedCallee;

        // Calls. The frame of the callee is `frame` words below this one, and the instruction fills its header.

        Call call Throws { dst: Dst, callee: Src, this: Src, count: ArgumentCount, frame: Frame } => Call;
        Call1 call1 Throws { dst: Dst, callee: Src, this: Src, first: Src, frame: Frame1 } => Call;
        Call2 call2 Throws { dst: Dst, callee: Src, this: Src, first: Src, second: Src, frame: Frame2 } => Call;
        /// `ret dst` follows.
        TailCall tail_call Throws { dst: Dst, callee: Src, this: Src, count: ArgumentCount, frame: Frame } => Call;
        Construct construct Throws { dst: Dst, callee: Src, new_target: Src, count: ArgumentCount, frame: Frame } => Call;
        SuperConstruct super_construct Throws { dst: Dst, callee: Reg, new_target: Reg, count: ArgumentCount, frame: Frame } => SuperConstruct;
        /// `arguments` comes from `spread` or `to_argument_list`, or is an array that nothing else has seen. Empty
        /// stands for the arguments of this frame. So many are left out at the start of either.
        CallVarargs call_varargs Throws { dst: Dst, callee: Src, this: Src, arguments: Src, skip_in_list: Unsigned, skip_in_frame: Unsigned } => Call;
        TailCallVarargs tail_call_varargs Throws { dst: Dst, callee: Src, this: Src, arguments: Src, skip_in_list: Unsigned, skip_in_frame: Unsigned } => Call;
        ConstructVarargs construct_varargs Throws { dst: Dst, callee: Src, new_target: Src, arguments: Src, skip_in_frame: Unsigned } => Call;
        SuperConstructVarargs super_construct_varargs Throws { dst: Dst, callee: Reg, new_target: Reg, arguments: Src, skip_in_frame: Unsigned } => SuperConstruct;
        /// The arguments follow `this`. As above for a list that is empty.
        CallWithSpread call_with_spread Throws { dst: Dst, callee: Src, this: First, count: Count, mask: SpreadMask, skip_in_frame: Unsigned } => Call;
        TailCallWithSpread tail_call_with_spread Throws { dst: Dst, callee: Src, this: First, count: Count, mask: SpreadMask, skip_in_frame: Unsigned } => Call;
        /// PerformEval. The callee was `%eval%`.
        DirectEval direct_eval Throws { dst: Dst, source: Src, scope: Reg, context: Context } => Value;
        DynamicImport dynamic_import Throws { dst: Dst, specifier: Src, options: Src, scope: Reg, phase: ImportPhase };

        // Operators

        Add add Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        Subtract subtract Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        Multiply multiply Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        Divide divide Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        Remainder remainder Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        Exponentiate exponentiate Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        BitAnd bit_and Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        BitOr bit_or Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        BitXor bit_xor Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        ShiftLeft shift_left Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        ShiftRight shift_right Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        ShiftRightUnsigned shift_right_unsigned Throws { dst: Dst, lhs: Src, rhs: Src } => BinaryArithmetic;
        /// The 32 bits of the result as an int32, for a consumer that takes them so.
        ShiftRightUnsignedBits shift_right_unsigned_bits Throws { dst: Dst, lhs: Src, rhs: Src };
        Negate negate Throws { dst: Dst, value: Src } => UnaryArithmetic;
        BitNot bit_not Throws { dst: Dst, value: Src } => UnaryArithmetic;
        Increment increment Throws { dst: Dst, value: Reg } => UnaryArithmetic;
        Decrement decrement Throws { dst: Dst, value: Reg } => UnaryArithmetic;
        /// `old` is another register than `value`.
        PostIncrement post_increment Throws { old: Dst, value: Mut } => UnaryArithmetic;
        PostDecrement post_decrement Throws { old: Dst, value: Mut } => UnaryArithmetic;
        Not not Pure { dst: Dst, value: Src };
        Typeof type_of Pure { dst: Dst, value: Src };
        /// The operands are primitives.
        Concatenate concatenate Throws { dst: Dst, first: First, count: Count };
        ToNumber to_number Throws { dst: Dst, value: Src } => UnaryArithmetic;
        ToNumeric to_numeric Throws { dst: Dst, value: Src } => UnaryArithmetic;
        ToString to_string Throws { dst: Dst, value: Src };
        ToPrimitive to_primitive Throws { dst: Dst, value: Src };
        ToPropertyKey to_property_key Throws { dst: Dst, value: Src };
        ToPropertyKeyOrNumber to_property_key_or_number Throws { dst: Dst, value: Src };
        /// `message` is the text of the error, unless it is the empty string.
        ToObject to_object Throws { dst: Dst, value: Src, message: Name } => Value;

        Equal equal Throws { dst: Dst, lhs: Src, rhs: Src };
        NotEqual not_equal Throws { dst: Dst, lhs: Src, rhs: Src };
        StrictEqual strict_equal Throws { dst: Dst, lhs: Src, rhs: Src };
        StrictNotEqual strict_not_equal Throws { dst: Dst, lhs: Src, rhs: Src };
        Less less Throws { dst: Dst, lhs: Src, rhs: Src };
        LessEqual less_equal Throws { dst: Dst, lhs: Src, rhs: Src };
        Greater greater Throws { dst: Dst, lhs: Src, rhs: Src };
        GreaterEqual greater_equal Throws { dst: Dst, lhs: Src, rhs: Src };
        /// Of two int32 taken as unsigned.
        Below below Pure { dst: Dst, lhs: Src, rhs: Src };
        BelowEqual below_equal Pure { dst: Dst, lhs: Src, rhs: Src };
        /// Whether the bits are the same. Either may be empty.
        Identical identical Pure { dst: Dst, lhs: Src, rhs: Src };
        NotIdentical not_identical Pure { dst: Dst, lhs: Src, rhs: Src };
        /// `value == null`, which holds for an object that poses as undefined too.
        EqualNull equal_null Pure { dst: Dst, value: Src };
        NotEqualNull not_equal_null Pure { dst: Dst, value: Src };
        IsNullish is_nullish Pure { dst: Dst, value: Src };
        IsBoolean is_boolean Pure { dst: Dst, value: Src };
        IsNumber is_number Pure { dst: Dst, value: Src };
        IsObject is_object Pure { dst: Dst, value: Src };
        IsCallable is_callable Pure { dst: Dst, value: Src };
        IsConstructor is_constructor Pure { dst: Dst, value: Src };
        IsCellOfType is_cell_of_type Pure { dst: Dst, value: Src, cell_type: CellType };
        HasShapeWithFlags has_shape_with_flags Pure { dst: Dst, object: Src, flags: Unsigned };
        TypeofIsUndefined typeof_is_undefined Pure { dst: Dst, value: Src };
        TypeofIsObject typeof_is_object Pure { dst: Dst, value: Src };
        TypeofIsFunction typeof_is_function Pure { dst: Dst, value: Src };

        // Jumps

        Goto jump Jumps { target: Target };
        JumpIfTrue jump_if_true Pure { value: Src, target: Target };
        JumpIfFalse jump_if_false Pure { value: Src, target: Target };
        JumpIfEqual jump_if_equal Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfNotEqual jump_if_not_equal Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfStrictEqual jump_if_strict_equal Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfStrictNotEqual jump_if_strict_not_equal Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfLess jump_if_less Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfLessEqual jump_if_less_equal Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfGreater jump_if_greater Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfGreaterEqual jump_if_greater_equal Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfNotLess jump_if_not_less Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfNotLessEqual jump_if_not_less_equal Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfNotGreater jump_if_not_greater Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfNotGreaterEqual jump_if_not_greater_equal Throws { lhs: Src, rhs: Src, target: Target };
        JumpIfBelow jump_if_below Pure { lhs: Src, rhs: Src, target: Target };
        JumpIfBelowEqual jump_if_below_equal Pure { lhs: Src, rhs: Src, target: Target };
        JumpIfIdentical jump_if_identical Pure { lhs: Src, rhs: Src, target: Target };
        JumpIfNotIdentical jump_if_not_identical Pure { lhs: Src, rhs: Src, target: Target };
        JumpIfEqualNull jump_if_equal_null Pure { value: Src, target: Target };
        JumpIfNotEqualNull jump_if_not_equal_null Pure { value: Src, target: Target };
        JumpIfNullish jump_if_nullish Pure { value: Src, target: Target };
        JumpIfNotNullish jump_if_not_nullish Pure { value: Src, target: Target };
        JumpIfNumber jump_if_number Pure { value: Src, target: Target };
        JumpIfNotNumber jump_if_not_number Pure { value: Src, target: Target };
        JumpIfObject jump_if_object Pure { value: Src, target: Target };
        JumpIfNotObject jump_if_not_object Pure { value: Src, target: Target };
        JumpIfCellOfType jump_if_cell_of_type Pure { value: Src, cell_type: CellType, target: Target };
        JumpIfNotCellOfType jump_if_not_cell_of_type Pure { value: Src, cell_type: CellType, target: Target };
        JumpIfTypeofUndefined jump_if_typeof_undefined Pure { value: Src, target: Target };
        JumpIfTypeofNotUndefined jump_if_typeof_not_undefined Pure { value: Src, target: Target };
        JumpIfTypeofObject jump_if_typeof_object Pure { value: Src, target: Target };
        JumpIfTypeofNotObject jump_if_typeof_not_object Pure { value: Src, target: Target };
        JumpIfTypeofFunction jump_if_typeof_function Pure { value: Src, target: Target };
        JumpIfTypeofNotFunction jump_if_typeof_not_function Pure { value: Src, target: Target };
        /// `jump_if_identical` that remembers whether it ever fell through.
        JumpIfBuiltin jump_if_builtin Pure { value: Reg, builtin: Src, target: Target } => Branch;
        SwitchInt switch_int Jumps { value: Src, table: IntSwitch };
        /// On the code unit of a string that has one.
        SwitchChar switch_char Ends { value: Src, table: IntSwitch };
        SwitchString switch_string Ends { value: Src, table: StringSwitch };

        // Exceptions

        /// The first instruction of a handler. `exception` is the record that `rethrow` takes.
        Catch catch Pure { exception: Dst, value: Dst } => Catch;
        Throw throw Ends { value: Src };
        Rethrow rethrow Ends { exception: Reg };
        /// Does nothing if `exception` is empty.
        RethrowIfAny rethrow_if_any Throws { exception: Reg };
        /// `message` is a string.
        ThrowError throw_error Ends { kind: ErrorKind, message: Src };
        ThrowStatic throw_static Ends { error: StaticError, name: Name };
        ThrowIfNotObject throw_if_not_object Throws { value: Src, error: StaticError };
        ThrowIfNullish throw_if_nullish Throws { value: Src, error: StaticError, name: Name };
        /// GetDisposeMethod, and the checks of CreateDisposableResource. Undefined for undefined and null.
        GetDisposeMethod get_dispose_method Throws { dst: Dst, value: Src, is_async: Flag };
        NewSuppressedError new_suppressed_error Throws { dst: Dst, error: Reg, suppressed: Reg };

        // `for`-`in`. The state is the enumerator, its mode and its index.

        /// Jumps if there is nothing to enumerate.
        ForInOpen for_in_open Throws { state: Dst3, base: Src, empty: Target };
        ForInNext for_in_next Throws { name: DstUnlessJumps, state: Mut3, base: Reg, done: Target } => ForIn;
        /// `name` is still what `for_in_next` made it. `base` is any value.
        ForInGet for_in_get Throws { dst: Dst, base: Src, name: Reg, state: Reg3 } => ForInGet;
        ForInPut for_in_put Throws { base: Src, name: Reg, state: Reg3, value: Src, strict: Flag } => ForIn;
        ForInHas for_in_has Throws { dst: Dst, base: Src, name: Reg, state: Reg3 } => ForIn;
        ForInHasOwn for_in_has_own Throws { dst: Dst, base: Src, name: Reg, state: Reg3 } => ForIn;

        // Iteration. The state is the iterator, its `next` and whether it is done. For the built-in kinds it is
        // whatever steps fastest, with a sentinel for `next`.

        /// Jumps if `iterable` is of a built-in kind. Otherwise throws unless `method` is callable and sets only
        /// the third register: the instructions that follow fill the first two.
        IteratorOpen iterator_open Throws { state: Dst3, iterable: Src, method: Reg, opened: Target } => IterationModes;
        /// Steps a built-in kind. For any other jumps to `generic`, having done nothing.
        IteratorNext iterator_next Throws { value: DstUnlessJumps, state: Mut3, done: Target, generic: Target } => IteratorNext;
        /// GetIterator as a whole, for patterns.
        IteratorBegin iterator_begin Throws { state: Dst3, iterable: Src } => IterationModes;
        /// IteratorStepValue as a whole. Undefined once the iterator is done.
        IteratorStep iterator_step Throws { value: Dst, state: Mut3 } => IteratorNext;
        /// IteratorStep: a hole in a pattern.
        IteratorSkip iterator_skip Throws { state: Mut3 };
        /// An array of what is left.
        IteratorRest iterator_rest Throws { dst: Dst, state: Mut3 };
        /// IteratorClose, unless the iterator is done.
        IteratorClose iterator_close Throws { state: Reg3, mode: CloseMode } => IterationModes;
        /// The state is the iterator and its `next`. Jumps if `method` is undefined or null, having wrapped the
        /// iterator of `iterable`, or if `iterable` is a pristine async generator.
        AsyncIteratorOpen async_iterator_open Throws { state: Dst2, iterable: Src, method: Reg, opened: Target } => IterationModes;
        /// If `next` is the sentinel, queues a request whose answer resumes `generator`, leaves in `dst` what makes
        /// `await` wait for just that, and jumps. `value` is empty for a call without arguments.
        AsyncIteratorNext async_iterator_next Throws { dst: DstIfJumps, state: Reg2, generator: Mut, value: Src, queued: Target } => IterationModes;

        // Code that suspends has no parameter but `this`, so a call passes enough. A resumption enters it with an
        // argument count of zero and the generator, the value and the mode in `this` and the next two slots.

        /// On a resumption, jumps to the `resume` of the point where the generator is suspended.
        ResumeDispatch resume_dispatch Pure {};
        CreateGenerator create_generator Throws { dst: Dst } => CachedCallee;
        CreateAsyncGenerator create_async_generator Throws { dst: Dst } => CachedCallee;
        /// Saves the registers of `point` in the generator and returns `value`.
        Suspend suspend Suspends { generator: Reg, value: Src, kind: SuspendKind, point: SuspendPoint };
        /// In an async function or a module. `generator` is empty until the first suspension, which creates it
        /// with its promise. Subscribes to `value`, saves the registers and returns the promise.
        Await r#await Suspends { generator: Mut, value: Src, point: SuspendPoint };
        /// Restores the registers of `point`.
        Resume resume Pure { generator: Dst, point: SuspendPoint };
        /// The value of the resumption. Throws it if the mode says so, and jumps unless it is to be returned.
        ResumeAfterYield resume_after_yield Throws { dst: Dst, normal: Target } => Value;
        ResumeAfterAwait resume_after_await Throws { dst: Dst } => Value;
        ResumeAfterDelegate resume_after_delegate Pure { value: Dst, mode: Dst } => Value;
        /// Marks the generator completed.
        GeneratorReturn generator_return Ends { generator: Reg, value: Src };
        GeneratorThrow generator_throw Ends { generator: Reg, exception: Reg };
        /// Resolves the promise of `generator`, or a new one if that is empty, and returns it.
        AsyncReturn async_return Ends { generator: Src, value: Src };
        AsyncThrow async_throw Ends { generator: Src, value: Reg };
        /// Marks a suspended generator executing and enters its code.
        ResumeGenerator resume_generator Throws { dst: Dst, generator: Src, value: Src, mode: Src, frame: Frame2 } => Call;

        // Tools

        /// Does nothing unless a debugger steps, has a request for the code block, or it is a `debugger` statement.
        Debug debug Throws { hook: DebugHook };
        /// Around a suspension. Does nothing unless a debugger steps. Then it creates `generator` as `await` would.
        DebugAwait debug_await Throws { hook: DebugHook, generator: Mut };
        /// Before a tail call. Jumps to where it is made as an ordinary call, followed by `DidReturnFromTailCall`,
        /// unless many frames in a row have been kept that way.
        JumpIfFrameIsKept jump_if_frame_is_kept Pure { target: Target };
        Cover cover Pure { block: CoverageBlock } => Coverage;
    } };
}
