# From Highway

## The most common names

| Highway | bun_simd |
| --- | --- |
| `ScalableTag<T>`, `CappedTag`, `Full128<T>` | `SimdN<T, S>` or `u8xN<S>`, `Simd<T, Upto<B32, S>, S>`, `Simd<T, B16, S>` or `u8x16<S>` |
| `Repartition<U, D>`, `Rebind<U, D>`, `Half<D>` | `Simd<U, W, S>`, `Simd<U, Scaled<T, U, W>, S>`, `Simd<T, Half<W>, S>`, which are mostly inferred |
| `Lanes(d)`, `Set(d, x)`, `Iota(d, 0)` | `u8xN::LANES`, `u8xN::splat(x)`, `u8xN::iota(0)` |
| `LoadU(d, p)`, `LoadN(d, p, n)`, `LoadDup128(d, p)` | `u8xN::load(slice)`, `load_or_default(slice)`, `repeat(&array)` |
| `StoreU(v, d, p)`, `StoreN`, `BlendedStore` | `v.store(slice)`, `v.store_partial(slice)`, `v.store_select(slice, m)` |
| `Add(a, b)`, `ShiftLeft<3>(v)`, `AndNot(a, b)` | `a + b`, `v << 3`, `!a & b` |
| `Eq(a, b)`, `Min(a, b)`, `IfThenElse(m, a, b)` | `a.simd_eq(b)`, `a.simd_min(b)`, `m.select(a, b)` |
| `FindFirstTrue(d, m)`, `AllFalse(d, m)`, `BitsFromMask` | `m.first_set()`, `m.none()`, `m.to_bitmask()` |
| `PromoteTo`, `ConvertTo`, `TruncateTo`; `DemoteTo` | `v.cast::<U>()`; `v.saturating_cast::<U>()` |
| `PromoteLowerTo`, `PromoteUpperTo`; `OrderedDemote2To` | `let [lo, hi] = v.widen()`; `lo.saturating_narrow(hi)` |
| `Combine(d, hi, lo)`, `LowerHalf`, `UpperHalf` | `lo.concat(hi)`, `let [lo, hi] = v.split()` |
| `InterleaveLower`, `InterleaveUpper`, `TableLookupBytes` | `a.in_blocks().interleave(b)`, `table.in_blocks().lookup_bytes(at)` |
| `WidenMulPairwiseAdd`, `SumOfMulQuadAccumulate`, `SumsOf8` | `a.dot::<U>(b)`, `a.dot_add(b, sum)`, `v.sum_groups::<u64>()` |
| `ReorderWidenMulAccumulate`, `RearrangeToOddPlusEven` | `PairSums` |
| `MulAdd` | `mul_add_relaxed`. `mul_add` rounds once on all CPUs |
| `contrib/algo`: `FindIf`, `Transform`, `CopyIf` | `over(x).position(..)`, `.map_into(..)`, `.filter_into(..)` |
| `HWY_DYNAMIC_DISPATCH(f)`, `HWY_STATIC_DISPATCH(f)` | `f(..)`, `f::baseline(..)` of a `#[kernel]` |
| `HWY_NAMESPACE`, `HWY_ATTR`, a call within it | `#[simd]`, `f::here(..)` |
| `HWY_DISABLED_TARGETS` | `#[simd(avx2, sse4, neon)]` |
| `#if HWY_MAX_BYTES >= 32` | `if const { Native::<S>::BYTES >= 32 }`, or `#[only(avx2)]`. In `pick! { B32 => .., _ => .. }` the types know the width |

## All operations

The operations of Highway's `quick_reference.md` (commit 2607d3b).

A masked operation is the operation and a selection, which LLVM fuses where the target has masked instructions:
`MaskedXOr(no, m, ..)` is `m.select(x, no)`, `MaskedX(m, ..)` is `m.select(x, 0)`, and a masked comparison
is `m & x`.

### Initialization

| Highway | bun_simd |
| --- | --- |
| `Zero` | `zero` |
| `Set` | `splat` |
| `Undefined` | `zero`: safe Rust has no uninitialized vectors |
| `Iota` | `iota` |
| `SignBit` | `sign_bit` |
| `Dup128VecFromValues` | `repeat(&[..])` |
| `MaskedSetOr` | `m.select(a, no)` |
| `MaskedSet` | `m.select(a, 0)` |

### Getting/setting lanes

| Highway | bun_simd |
| --- | --- |
| `GetLane` | `lane::<0>`, `v[0]` |
| `ExtractLane` | `lane::<K>`, `lane_dyn`, `v[i]` |
| `InsertLane` | `with_lane::<K>`, `with_lane_dyn` |

### Getting/setting blocks

| Highway | bun_simd |
| --- | --- |
| `ExtractBlock` | `block` |
| `InsertBlock` | `with_block` |
| `Blocks` | `W::BYTES.div_ceil(16)` |

### Printing

| Highway | bun_simd |
| --- | --- |
| `Print` | `{:?}` |

### Tuples

| Highway | bun_simd |
| --- | --- |
| `Create2` | arrays or tuples of vectors |
| `Create3` | arrays or tuples of vectors |
| `Create4` | arrays or tuples of vectors |
| `Get2` | arrays or tuples of vectors |
| `Get3` | arrays or tuples of vectors |
| `Get4` | arrays or tuples of vectors |
| `Set2` | arrays or tuples of vectors |
| `Set3` | arrays or tuples of vectors |
| `Set4` | arrays or tuples of vectors |

### Arithmetic

| Highway | bun_simd |
| --- | --- |
| `operator+` | `a + b` |
| `operator-` | `a - b` |
| `AddSub` | `add_sub` |
| `Neg` | `-v` |
| `SaturatedNeg` | `saturating_neg` |
| `Abs` | `abs` |
| `SaturatedAbs` | `saturating_abs` |
| `AbsDiff` | `abs_diff`, whose result is unsigned, or `(a - b).abs()` for floats |
| `PairwiseAdd` | `let [even, odd] = a.transpose_pairs(b); even + odd` |
| `PairwiseSub` | `let [even, odd] = a.transpose_pairs(b); odd - even` |
| `SumsOf2` | `sum_groups` |
| `SumsOf4` | `sum_groups` |
| `SumsOf8` | `sum_groups` |
| `SumsOf8AbsDiff` | `abs_diff_sum` |
| `SumsOfAdjQuadAbsDiff` | `in_blocks().sliding_abs_diff_sum` |
| `SumsOfShuffledQuadAbsDiff` | `in_blocks().shuffled_abs_diff_sum` |
| `SaturatedAdd` | `saturating_add` |
| `SaturatedSub` | `saturating_sub` |
| `AverageRound` | `midpoint_up` |
| `Clamp` | `simd_clamp_relaxed`, or `simd_clamp` |
| `operator/` | `a / b` |
| `operator%` | `a % b` |
| `Sqrt` | `sqrt` |
| `ApproximateReciprocalSqrt` | `recip_sqrt_relaxed` |
| `ApproximateReciprocal` | `recip_relaxed` |
| `GetExponent` | `exponent_relaxed` |
| `GetBiasedExponent` | `biased_exponent` |

### Min/Max

| Highway | bun_simd |
| --- | --- |
| `Min` | `simd_min_relaxed`, or `simd_min` |
| `Max` | `simd_max_relaxed`, or `simd_max` |
| `MinNumber` | `simd_min` |
| `MaxNumber` | `simd_max` |
| `MinMagnitude` | `min_magnitude` |
| `MaxMagnitude` | `max_magnitude` |
| `Min128` | `as_u128s().simd_min` |
| `Max128` | `as_u128s().simd_max` |
| `Min128Upper` | `as_u128s().by_upper().simd_min` |
| `Max128Upper` | `as_u128s().by_upper().simd_max` |

### Multiply

| Highway | bun_simd |
| --- | --- |
| `operator*` | `a * b` |
| `MulRound` | `(a * b).round_ties_even()` |
| `MulByPow2` | `ldexp` |
| `MulByFloorPow2` | `ldexp_floor` |
| `MulHigh` | `mul_high` |
| `MulFixedPoint15` | `mul_q15_relaxed` |
| `MulEven` | `widening_mul_even` |
| `MulOdd` | `widening_mul_odd` |
| `WidenMulPairwiseAdd` | `dot` (integers) |
| `SatWidenMulPairwiseAdd` | `saturating_dot` |
| `SatWidenMulPairwiseAccumulate` | `saturating_dot_add` |
| `SatWidenMulAccumFixedPoint` | `cast_mul_q15_add` |
| `ReorderWidenMulAccumulate` | `PairSums::mul_add` (integers) |
| `RearrangeToOddPlusEven` | `PairSums::total` (integers) |
| `SumOfMulQuadAccumulate` | `dot_add`, `dot_add::<i32>` for `u8` by `i8` |
| `WidenMulAccumulate` | `widening_mul_add` |

### Fused multiply-add

| Highway | bun_simd |
| --- | --- |
| `MulAdd` | `mul_add_relaxed`. `mul_add` rounds once on all CPUs |
| `NegMulAdd` | `(-a).mul_add_relaxed(b, c)` |
| `MulSub` | `a.mul_add_relaxed(b, -c)` |
| `NegMulSub` | `(-a).mul_add_relaxed(b, -c)` |
| `MulAddSub` | `mul_add_sub_relaxed` |
| `MulSubAdd` | `mul_sub_add_relaxed` |
| `MulEvenAdd` | see the conversions (bf16) |
| `MulOddAdd` | see the conversions (bf16) |

### Masked arithmetic

| Highway | bun_simd |
| --- | --- |
| `MaskedSqrtOr` | `m.select(x, no)` |
| `MaskedMinOr` | `m.select(x, no)` |
| `MaskedMaxOr` | `m.select(x, no)` |
| `MaskedAddOr` | `m.select(x, no)` |
| `MaskedSubOr` | `m.select(x, no)` |
| `MaskedMulOr` | `m.select(x, no)` |
| `MaskedDivOr` | `m.select(x, no)` |
| `MaskedModOr` | `m.select(x, no)` |
| `MaskedSatAddOr` | `m.select(x, no)` |
| `MaskedSatSubOr` | `m.select(x, no)` |
| `MaskedMulAddOr` | `m.select(x, no)` |
| `MaskedAbsOr` | `m.select(x, no)` |

### Zero masked arithmetic

| Highway | bun_simd |
| --- | --- |
| `MaskedAbs` | `m.select(x, 0)` |
| `MaskedMax` | `m.select(x, 0)` |
| `MaskedAdd` | `m.select(x, 0)` |
| `MaskedSub` | `m.select(x, 0)` |
| `MaskedMul` | `m.select(x, 0)` |
| `MaskedDiv` | `m.select(x, 0)` |
| `MaskedSaturatedAdd` | `m.select(x, 0)` |
| `MaskedSaturatedSub` | `m.select(x, 0)` |
| `MaskedMulFixedPoint15` | `m.select(x, 0)` |
| `MaskedMulAdd` | `m.select(x, 0)` |
| `MaskedNegMulAdd` | `m.select(x, 0)` |
| `MaskedWidenMulPairwiseAdd` | `m.select(x, 0)` |
| `MaskedSqrt` | `m.select(x, 0)` |
| `MaskedApproximateReciprocalSqrt` | `m.select(x, 0)` |
| `MaskedApproximateReciprocal` | `m.select(x, 0)` |

### Complex number operations

| Highway | bun_simd |
| --- | --- |
| `ComplexConj` | `complex_conj` |
| `MulComplex` | `complex_mul_relaxed` |
| `MulComplexConj` | `complex_mul_conj_relaxed` |
| `MulComplexAdd` | `complex_mul_add_relaxed` |
| `MulComplexConjAdd` | `complex_mul_conj_add_relaxed` |
| `MaskedMulComplexConjAdd` | `m.select(x, 0)` |
| `MaskedMulComplexConj` | `m.select(x, 0)` |
| `MaskedMulComplexOr` | `m.select(x, no)` |

### Shifts

| Highway | bun_simd |
| --- | --- |
| `ShiftLeft` | `v << n` |
| `ShiftRight` | `v >> n` |
| `RoundingShiftRight` | `rounding_shr` |
| `RotateLeft` | `rotate_left` |
| `RotateRight` | `rotate_right` |
| `ShiftLeftSame` | `v << n` |
| `ShiftRightSame` | `v >> n` |
| `RoundingShiftRightSame` | `rounding_shr` |
| `RotateLeftSame` | `rotate_left` |
| `RotateRightSame` | `rotate_right` |
| `operator<<` | `a << b` |
| `operator>>` | `a >> b` |
| `RoundingShr` | `rounding_shr` |
| `Rol` | `rotate_left` |
| `Ror` | `rotate_right` |
| `MultiRotateRight` | `rotate_bytes_from` |

### Masked Shifts

| Highway | bun_simd |
| --- | --- |
| `MaskedShiftLeft` | `m.select(x, 0)` |
| `MaskedShiftRight` | `m.select(x, 0)` |
| `MaskedShiftRightOr` | `m.select(x, no)` |
| `MaskedShrOr` | `m.select(x, no)` |

### Floating-point rounding

| Highway | bun_simd |
| --- | --- |
| `Round` | `round_ties_even` |
| `Trunc` | `trunc` |
| `Ceil` | `ceil` |
| `Floor` | `floor` |

### Floating-point classification

| Highway | bun_simd |
| --- | --- |
| `IsNaN` | `is_nan` |
| `IsEitherNaN` | `a.is_nan() \| b.is_nan()` |
| `IsInf` | `is_infinite` |
| `IsFinite` | `is_finite` |

### Masked floating-point classification

| Highway | bun_simd |
| --- | --- |
| `MaskedIsNaN` | `m & x` |

### Logical

| Highway | bun_simd |
| --- | --- |
| `PopulationCount` | `count_ones` |
| `LeadingZeroCount` | `leading_zeros` |
| `MaskedLeadingZeroCount` | `m.select(x, 0)` |
| `TrailingZeroCount` | `trailing_zeros` |
| `HighestSetBitIndex` | `ilog2` |
| `AllBits1` | `v == !0` |
| `AllBits0` | `v == 0` |
| `operator&` | `a & b` |
| `operator\|` | `a \| b` |
| `operator^` | `a ^ b` |
| `Not` | `!v` |
| `AndNot` | `!a & b` |
| `MaskedOr` | `m.select(x, 0)` |
| `Xor3` | `a ^ b ^ c` |
| `Or3` | `a \| b \| c` |
| `OrAnd` | `o \| a & b` |
| `XorAndNot` | `x ^ !a & b` |
| `BitwiseIfThenElse` | `bit_select` |
| `CopySign` | `copysign` |
| `CopySignToAbs` | `a \| b & -0.0` |
| `BroadcastSignBit` | `a >> (T::BITS - 1)` |
| `ZeroIfNegative` | `a.is_negative().select(0, a)` |
| `IfNegativeThenElse` | `a.is_negative().select(b, c)` |
| `IfNegativeThenElseZero` | `v.is_negative().select(yes, 0)` |
| `IfNegativeThenZeroElse` | `v.is_negative().select(0, no)` |
| `IfNegativeThenNegOrUndefIfZero` | `neg_if_negative_relaxed` |

### Create mask

| Highway | bun_simd |
| --- | --- |
| `FirstN` | `Mask::first_n` |
| `MaskFromVec` | `v.cast_signed().is_negative()` |
| `LoadMaskBits` | `Mask::load_bitmask`, `Mask::from_bitmask(u64)` |
| `Dup128MaskFromMaskBits` | `Mask::repeat_bitmask` |
| `MaskFalse(D)` | `Mask::splat` |
| `SetMask` | `Mask::splat` |

### Convert mask

| Highway | bun_simd |
| --- | --- |
| `RebindMask` | `cast` |
| `VecFromMask` | `to_simd` |
| `BitsFromMask` | `to_bitmask` |
| `StoreMaskBits` | `m.store_bitmask` |
| `PromoteMaskTo` | `cast` |
| `DemoteMaskTo` | `cast` |
| `OrderedDemote2MasksTo` | `narrow` |

### Combine mask

| Highway | bun_simd |
| --- | --- |
| `LowerHalfOfMask` | `split` |
| `UpperHalfOfMask` | `split` |
| `CombineMasks` | `concat` |

### Slide mask across blocks

| Highway | bun_simd |
| --- | --- |
| `SlideMaskUpLanes` | `m.shift_elements_right_dyn(n, false)` |
| `SlideMaskDownLanes` | `m.shift_elements_left_dyn(n, false)` |
| `SlideMask1Up` | `m.shift_elements_right::<1>(false)` |
| `SlideMask1Down` | `m.shift_elements_left::<1>(false)` |

### Test mask

| Highway | bun_simd |
| --- | --- |
| `AllTrue` | `all` |
| `AllFalse` | `none` |
| `CountTrue` | `count` |
| `FindFirstTrue` | `first_set` |
| `FindKnownFirstTrue` | `first_set_relaxed` |
| `FindLastTrue` | `last_set` |
| `FindKnownLastTrue` | `last_set_relaxed` |

### Ternary operator for masks

| Highway | bun_simd |
| --- | --- |
| `IfThenElse` | `select` |
| `IfThenElseZero` | `m.select(v, 0)` |
| `IfThenZeroElse` | `m.select(0, v)` |
| `IfVecThenElse` | `bit_select` |

### Logical mask

| Highway | bun_simd |
| --- | --- |
| `Not` | `!v` |
| `And` | `a & b` |
| `AndNot` | `!a & b` |
| `Or` | `a \| b` |
| `Xor` | `a ^ b` |
| `ExclusiveNeither` | `!(a \| b)` |
| `SetOnlyFirst` | `only_first` |
| `SetBeforeFirst` | `before_first` |
| `SetAtOrBeforeFirst` | `through_first` |
| `SetAtOrAfterFirst` | `from_first` |

### Comparisons

| Highway | bun_simd |
| --- | --- |
| `operator==`, `Eq` | `simd_eq` |
| `operator!=`, `Ne` | `simd_ne` |
| `operator<`, `Lt` | `simd_lt` |
| `operator>`, `Gt` | `simd_gt` |
| `operator<=`, `Le` | `simd_le` |
| `operator>=`, `Ge` | `simd_ge` |
| `IsNegative` | `is_negative` |
| `TestBit` | `all_bits` |
| `Lt128` | `as_u128s().simd_lt` |
| `Lt128Upper` | `as_u128s().by_upper().simd_lt` |
| `Eq128` | `as_u128s().simd_eq` |
| `Ne128` | `!a.as_u128s().simd_eq(b)` |
| `Eq128Upper` | `as_u128s().by_upper().simd_eq` |
| `Ne128Upper` | `!a.as_u128s().by_upper().simd_eq(b)` |

### Masked comparison

| Highway | bun_simd |
| --- | --- |
| `MaskedEq` | `m & x` |
| `MaskedNe` | `m & x` |
| `MaskedLt` | `m & x` |
| `MaskedGt` | `m & x` |
| `MaskedLe` | `m & x` |
| `MaskedGe` | `m & x` |

### Reductions

| Highway | bun_simd |
| --- | --- |
| `SumOfLanes` | `splat_sum` |
| `MinOfLanes` | `splat_min` |
| `MaxOfLanes` | `splat_max` |
| `ReduceSum` | `reduce_sum` |
| `ReduceMin` | `reduce_min` |
| `ReduceMax` | `reduce_max` |

### Masked reductions

| Highway | bun_simd |
| --- | --- |
| `MaskedReduceSum` | `m.select(v, 0).reduce_sum()` |
| `MaskedReduceMin` | `m.select(v, T::INFINITY).reduce_min_relaxed()` |
| `MaskedReduceMax` | `m.select(v, T::NEG_INFINITY).reduce_max_relaxed()` |

### Crypto

| Highway | bun_simd |
| --- | --- |
| `AESRound` | `aes_round` |
| `AESLastRound` | `aes_last_round` |
| `AESRoundInv` | `aes_round_inv` |
| `AESLastRoundInv` | `aes_last_round_inv` |
| `AESInvMixColumns` | `aes_inv_mix_columns` |
| `AESKeyGenAssist` | `aes_key_gen_assist` |
| `CLMulLower` | `carryless_mul_even` |
| `CLMulUpper` | `carryless_mul_odd` |

### Lanes, blocks, tuples

| Highway | bun_simd |
| --- | --- |
| ExtractBlock, InsertBlock, Blocks | `block`, `with_block`, `W::BYTES.div_ceil(16)` |
| Print | `Debug` |
| Create2-4, Get2-4, Set2-4 | arrays of vectors |

### Compress and expand

| Highway | bun_simd |
| --- | --- |
| Compress, CompressBits, CompressStore, CompressBitsStore | `compress_relaxed` or `compress`, `compress_store` and `out.push(v.selected(m))`, with a mask or bits |
| CompressNot, CompressBlocksNot | `v.compress_relaxed(!m)` |
| CompressIsPartition | `partition`, for all types |
| CompressBlendedStore | `compress_store_exact` |
| Expand, LoadExpand | `expand`, `load_expand` |

### Memory

| Highway | bun_simd |
| --- | --- |
| Load, LoadU, Store, StoreU | `load`, `store` (also `_last`, `_at`). `Aligned` tells the compiler the alignment |
| LoadDup128 | `load_block`; `repeat` for 1 to 64 bytes |
| MaskedLoad, MaskedLoadOr, BlendedStore | `load_select_or_default`, `load_select`, `store_select` |
| LoadN, LoadNOr, StoreN | `load_or_default`, `load_or`, `store_partial`. For rows: `load_row`, `store_row` |
| InsertIntoUpper, TruncateStore | `v.split()[0].concat(Simd::load(x))`, `v.cast::<U>().store(x)` |
| SafeFillN, SafeCopyN | `Simd::splat(x).store_partial(to)`, `Simd::load_or_default(from).store_partial(to)` |
| LoadInterleaved2-4, StoreInterleaved2-4 | `load_interleaved::<2>` and so on |
| GatherIndex, MaskedGatherIndex, MaskedGatherIndexOr | `gather_or_default`, `gather_select`, `gather_select`. All types of lanes, unsigned indices of any size. Those out of bounds are left out |
| ScatterIndex, MaskedScatterIndex | `scatter`, `scatter_select`, the same |
| GatherIndexN, ScatterIndexN | the masked ones with `Mask::first_n` |
| GatherOffset, ScatterOffset | `gather_bytes`, clamped. For a scatter, shift them to indices |
| Prefetch, Pause | `prefetch`, `prefetch_with`, `core::hint::spin_loop` |
| Stream, FlushStream | `streaming`, a scope that ends with the fence. `stream_into` and `stream_fill_with` are whole loops |
| FlushCacheline | left out: the intrinsic takes a pointer and is `unsafe` |

### Type conversion

`f16` and `bf16` are lanes with all operations of floats, on all targets.

| Highway | bun_simd |
| --- | --- |
| BitCast, ResizeBitCast, ZeroExtendResizeBitCast | `bitcast`, `resize` |
| ConvertTo, ConvertInRangeTo, MaskedConvertTo | `cast`, `cast_relaxed`, `m.select(v.cast::<U>(), 0)` |
| NearestInt, CeilInt, FloorInt, DemoteToNearestInt | `a.round_cast_relaxed::<U>()`, `a.ceil().cast_relaxed::<U>()`, `a.floor().cast_relaxed::<U>()`, `round_cast` |
| U8FromU32, TruncateTo, OrderedTruncate2To | `cast`, `wrapping_narrow` |
| DemoteTo, DemoteInRangeTo | `saturating_cast`, `cast`, `cast_relaxed` |
| PromoteTo, PromoteInRangeTo | `cast`, `cast_relaxed` |
| PromoteLowerTo, PromoteUpperTo | `widen(..)[0]`, `widen(..)[1]` |
| PromoteInRangeLowerTo, PromoteInRangeUpperTo | `cast_relaxed` of a half |
| PromoteEvenTo, PromoteOddTo, and InRange | `widen_even`, `widen_odd` |
| ReorderDemote2To, OrderedDemote2To | `in_blocks().saturating_narrow`, `saturating_narrow`, `narrow_even_odd`, `narrow` |

### Combine

| Highway | bun_simd |
| --- | --- |
| LowerHalf, UpperHalf, ZeroExtendVector, Combine | `split`, `split`, `resize`, `concat` |
| ConcatLowerLower, UpperUpper, LowerUpper, UpperLower, Odd, Even | `concat_halves::<0, 0>` and so on, `deinterleave` |
| InterleaveWholeLower, InterleaveWholeUpper | `interleave(..)[0]`, `interleave(..)[1]` |

### Blockwise

| Highway | bun_simd |
| --- | --- |
| Broadcast | `in_blocks().splat_lane` |
| TableLookupBytes, TableLookupBytesOr0 | `in_blocks().lookup_bytes` (also `in_blocks().concat_lookup_bytes`) |
| BitShuffle | `bit_shuffle` |
| PairwiseAdd128, PairwiseSub128 | `in_blocks().add_pairs`, `in_blocks().sub_pairs` |
| InterleaveLower, Upper, Even, Odd; ZipLower, ZipUpper | `in_blocks().interleave`, `transpose_pairs`; the first with `bitcast` |
| ShiftLeftBytes, ShiftRightBytes, ShiftLeftLanes, ShiftRightLanes | `in_blocks().shift_elements_right` and so on |
| CombineShiftRightBytes, CombineShiftRightLanes | `lo.in_blocks().shift_elements_left::<K>(hi)` |
| OddEven, DupEven, DupOdd | `alternate`, `swizzle_groups([0, 0])`, `swizzle_groups([1, 1])` |
| Shuffle1032, 0321, 2103 | `swizzle_groups([2, 3, 0, 1])`, `swizzle_groups([1, 2, 3, 0])`, `swizzle_groups([3, 0, 1, 2])` |
| Shuffle2301, Shuffle01, Shuffle0123 | `swap_pairs`, `swap_pairs`, `swizzle_groups([3, 2, 1, 0])` |

### Swizzle

| Highway | bun_simd |
| --- | --- |
| Reverse, Reverse2/4/8, ReverseBlocks, ReverseLaneBytes, ReverseBits | `reverse`, `swap_pairs`, `swizzle_groups`, `as_u128s().reverse`, `swap_bytes`, `reverse_bits` |
| TableLookupLanes, TwoTablesLookupLanes | `swizzle_dyn_relaxed`, `concat_swizzle_dyn_relaxed` |
| IndicesFromVec, SetTableIndices | not needed: indices are vectors. For constants, `swizzle` and `concat_swizzle` |
| Lookup8 | `lookup`, for tables of up to 1024 bytes |
| Per4LaneBlockShuffle | `swizzle_groups` |
| SlideUpLanes, SlideDownLanes, Slide1Up, Slide1Down | `shift_elements_right_dyn(n, 0)`, `shift_elements_left_dyn(n, 0)`, `shift_elements_right::<1>(0)`, `shift_elements_left::<1>(0)` |
| SlideUpBlocks, SlideDownBlocks | `as_u128s().shift_elements_right::<K>(0)`, `as_u128s().shift_elements_left::<K>(0)` |
| BroadcastLane, BroadcastBlock | `splat_lane`, `as_u128s().splat_lane` |
| OddEvenBlocks, SwapAdjacentBlocks | `as_u128s().alternate`, `as_u128s().swap_pairs` |
| InterleaveEvenBlocks, Odd, Lower, Upper | `as_u128s().transpose_pairs(..)[0]` and so on |
| not in Highway | `from_fn`, `swizzle`, `concat_swizzle`, `swizzle_groups`, `concat_swizzle_groups`, `transpose`, `transpose_in_blocks`, `shift_elements_right`, `shift_elements_left` |

Not in Highway: `Divisor`, `galois_mul`, `galois_affine`, `galois_affine_inverse`, `crc32`, `crc32c`, `within`, `any_bits`, `prefix_sum`.
