All operations, by what they are for.

`V` is a type of vector such as `u8x16`, `u8xN` or `Simd<T, W, S>`, and `M` a type of mask. Their functions can be called in what has
[`simd`][1] or [`kernel`]. `v` is a [`Simd`][3], and `m` a
[`Mask`], for which [`MaskOf`] and `mask8x16` to `mask64xN` are aliases. A width is `B2` to `B512`, `Native<S>`, `Upto<B32, S>`, `Half<W>` or `Twice<W>`. The prelude has all names. A *block* is 16 bytes of a vector, or all of a shorter one.

Where no result is written, it is of the type before the dot, or nothing. The result of what ends in `_relaxed` can depend on the CPU. The search also finds the names of Highway, such as `LoadU`, and of instructions.

# Making vectors

- **Constants:** [`V::splat(value)`], [`V::zero()`], [`V::iota(first)`],
  [`V::from(value)`], [`V::from_array(lanes)`], [`V::from_fn(|i| ..)`],
  [`V::repeat(&[..])`][12], [`V::sign_bit()`],
  [`V::LANES`], [`S::REGISTERS`]
- **Without dispatch:** [`Baseline`], as in `u8x16::<Baseline>::load(..)` and `crc32c::<_, Baseline>(..)`

# Memory

- **Whole vectors:** [`V::load(from)`], [`V::load_at(from, at)`],
  [`V::load_last(from)`], [`V::load_bytes(from)`],
  [`V::load_block(from)`], [`v.store(to)`],
  [`v.store_at(to, at)`], [`v.store_last(to)`],
  [`v.store_bytes(to)`]
- **An array at an index, with one check:** [`s.chunk_at::<N>(at) -> Option<&[T; N]>`][30], [`s.chunk_at_mut::<N>(at) -> Option<&mut [T; N]>`][31] of [`ChunkAt`]. At a constant place of an array, without a check: [`a.sub_array::<AT, N>() -> &[T; N]`][663], [`a.sub_array_mut::<AT, N>() -> &mut [T; N]`][664] of [`SubArray`]. Of an array of arrays: [`a.flat_array::<N>() -> &[T; N]`][665], [`a.flat_array_mut::<N>() -> &mut [T; N]`][666] of [`FlatArray`]
- **Tails:** [`V::load_or_default(from)`], [`V::load_or(from, or)`],
  [`V::load_padded(from, pad)`], [`V::load_row(rows, y)`], [`v.store_row(rows, y)`], [`V::load_short(from)`],
  [`V::load_select(from, enable, or)`], [`V::load_select_or_default(from, enable)`],
  [`v.store_partial(to)`], [`v.store_partial_at(to, at)`],
  [`v.store_short(to)`], [`v.store_select(to, enable)`]
- **Interleaved:** [`V::load_interleaved::<K>(from) -> [V; K]`][45],
  [`V::store_interleaved([..], to)`][46], [`V::load_interleaved_or_default::<K>(from) -> [V; K]`][47],
  [`V::store_interleaved_partial(vectors, to)`], [`V::load_3_of_4(from)`],
  [`v.store_3_of_4(to)`]
- **Lanes of variable length, also for escapes and byte stuffing:** [`V::load_low_bytes(from, more) -> (V, usize)`], [`v.store_low_bytes(to, more) -> usize`]
- **By index:** [`V::gather_or(table, indices, or)`], [`V::gather_or_default(table, indices)`],
  [`V::gather_select(table, enable, indices, or)`], [`V::gather_interleaved(table, indices) -> [V; K]`][56], [`V::gather_bytes(from, offsets)`], [`v.gather_windows(from) -> Option<[&[E; N]; K]>`][58], [`v.scatter(table, indices)`],
  [`v.scatter_select(table, enable, indices)`], [`v.lookup(table)`],
  [`v.lookup_relaxed(table)`], [`v.lookup_or(table, or)`]
- **Arrays of vectors:** [`array::from_fn(|i| ..) -> [T; N]`][64], [`array::map(array, f) -> [U; N]`][65], [`unroll!`], and the opposite, [`not_unrolled()`]
- **Appending to an [`Output`]:** [`out.push(piece)`], [`out.try_push(piece) -> Option<()>`], [`out.push_with_slack(piece)`], where a [`Piece`] is a lane, a vector, a slice,
  [`v.first_n(n) -> FirstN`], [`v.selected(keep) -> SelectedLanes`], [`v.low_bytes(more) -> LowBytes`], [`v.ascii() -> AsAscii`], or a tuple or an array of these,
  [`out.push_at(v, at)`], [`out.push_one(value)`],
  [`out.push_array([..]) -> &mut [T; N]`][76], [`set_bit_positions(bits, first, to) -> usize`],
  [`out.extend_from_back(distance, n) -> Option<()>`], [`out.room_for(n) -> Option<Room>`] and [`Room`], [`out.limit(n) -> Appending`],
  [`out.streams(each, |outs| ..) -> R`], [`Output::append(to, room) -> Appending`], [`Output::resume(to, history, room) -> Appending`], [`Output::overwrite(to)`]
- **Scratch memory without zeros:** [`Output::new(to)`], and to read it [`out.filled() -> &[T]`][89], [`out.filled_mut() -> &mut [T]`][90],
  [`out.into_filled() -> &mut [T]`][91], [`out.truncate(len)`], [`out.clear()`], and `len`, `is_empty`, `room`, `capacity`
- **Caches and alignment:** [`prefetch(values, at)`][94], [`prefetch_with(values, at, how)`], [`Prefetch`][96] (`L1`, `L2`, `L3`, `Once`, `Write`), [`Aligned`]
- **Rows with a stride, such as images, tiles and planes, with one check:** [`Rows`], [`RowsMut`], [`Rows::new(values, stride, width, height)`], [`rows.at(x, y, width, height)`], [`rows.row(y) -> &[T]`][659],
  and for threads or several rows at once [`split_at_row(y) -> (RowsMut, RowsMut)`], [`split_at_column(x) -> (RowsMut, RowsMut)`], [`rows_mut::<K>(y) -> [&mut [T]; K]`][102]
- **Stores that go around the caches, in any loop:** [`streaming(f) -> R`][103], [`s.lend(to)`], [`Streaming`][105], [`Streamed`], [`Lendable`]
- **Generic over the memory:** [`Shared`], [`Appendable`], [`Part`], [`Readable`], [`Writable`], [`Slice`], [`SliceMut`], [`Sink`],
  [`to.part(range) -> Part`], [`part.skip(n)`], [`part.write(at, values)`]
- **Single lanes, besides `v[i]`, `as_ref` and `as_mut`:** [`v.to_array() -> array`], [`v.lane::<K>() -> T`], [`v.lane_dyn(i) -> T`], [`v.with_lane::<K>(x)`], [`v.with_lane_dyn(i, x)`]

# Loops over slices

`over(slice)` and `over_mut(slice)` go by the width of the registers, and [`V::over(values) -> Over`] and
[`V::over_mut(values) -> OverMut`] by that of `V`. Their closures take one argument, which is a pair `|(a, b)|` after `zip` and an array after `windows`, `interleaved` and `over_all`.
Only those of `fold` take two. The output comes first: `map_into(to, |v| ..)`.

- **Iterators:** [`exact() -> (ExactSizeIterator, &[E])`][123], [`padded() -> ExactSizeIterator`][124] of `(v, valid)`, [`by::<W>()`][125], and [`pad(value) -> Columns`][126] for another padding than zero
- **Searching:** [`position(|v| m) -> Option<usize>`][127], [`rposition(|v| m) -> Option<usize>`][128], [`positions(|v| m) -> Iterator`][129],
  [`position_of_any(set) -> Option<usize>`], [`any(|v| m) -> bool`][131], [`all(|v| m) -> bool`][132],
  [`count(|v| m) -> usize`][133], [`counts(|v| [m; K]) -> [usize; K]`][134], [`bitmask(|v| m) -> u64`], [`bitmask_into(to, |v| m)`][136], [`is_sorted() -> bool`], [`cmp(other) -> Ordering`]
- **Text, also with [`Utf8`][139] and [`Ascii`]:** [`to_str() -> Result<&str>`], [`utf8() -> Utf8`][142], and the functions [`from_utf8(bytes) -> Result<&str>`] and
  [`string_from_utf8(bytes) -> Result<String>`]
- **Mapping:** [`map_into(to, f)`][145], [`scan_into(to, |v| ..)`][146], [`unzip_into(to, f)`][147], [`map_until(to, stop, f) -> usize`],
  [`filter_into(to, |v| m) -> usize`], [`filter_map_into(to, |v| (keep, value)) -> usize`][150], [`stream_into(to, f)`][151]
- **Reducing:** [`fold(init, step, join) -> A`][152], [`sum() -> T`][153], [`sum_wide() -> u64 or i64`],
  [`sum_relaxed() -> T`], [`min() -> Option<T>`][155], [`min_relaxed() -> Option<T>`],
  [`max() -> Option<T>`][157], [`max_relaxed() -> Option<T>`], [`min_max() -> Option<(T, T)>`],
  [`position_min() -> Option<usize>`], [`position_max() -> Option<usize>`],
  [`mat_vec(x, to)`], [`mat_vec_relaxed(x, to)`]
- **Several slices, neighbors and records, as [`Columns`]:** [`zip(other) -> Zip`][165], [`zip_scaled(other) -> Zip`][166], [`V::over_all(slices) -> Columns`],
  [`windows::<K>() -> Columns`], [`interleaved::<K>() -> Columns`], and then
  [`zip(other)`][170], [`zip_scaled(other)`][171], [`pad(value)`][172], [`len() -> usize`], [`is_empty() -> bool`], [`exact() -> (ExactSizeIterator, Columns)`][175], [`padded() -> ExactSizeIterator`][176],
  [`position(|v| m) -> Option<usize>`][177], [`rposition(|v| m) -> Option<usize>`][178], [`positions(|v| m) -> Iterator`][179], [`any(|v| m) -> bool`][180], [`all(|v| m) -> bool`][181], [`count(|v| m) -> usize`][182], [`counts(|v| [m; K]) -> [usize; K]`][183], [`bitmask_into(to, |v| m)`][184],
  [`fold(init, step, join) -> A`][185], [`map_into(to, f)`][186], [`scan_into(to, f)`][187], [`unzip_into(to, f)`][188], [`filter_map_into(to, f) -> usize`][189], [`stream_into(to, f)`][190]
- **Indices and bitmaps in memory:** [`enumerate::<U>() -> Columns`][191], [`zip_bits(bits) -> Columns`][192], [`expand_into(to, bits, fill) -> usize`], [`selected(bits) -> Selected`][194], also for `Columns` ([`enumerate::<U>()`][195],
  [`zip_bits(bits)`][196], [`selected(bits) -> Selected`][197]), and for what is [`Selected`][198] [`count() -> usize`][199], [`fold(init, step, join) -> A`][200], [`sum() -> T`][201],
  [`min() -> Option<T>`][202], [`max() -> Option<T>`][203], [`map_into(to, f) -> usize`][204]
- **Two slices:** [`dot() -> T`], [`dot_relaxed() -> T`], [`dot_wide() -> i32 or u32`], [`dot_wide_relaxed() -> f32`]
- **In place, after `over_mut`:** [`map(f)`][209], [`scan(f)`][210], [`retain(|v| m) -> usize`],
  [`fill_with(|indices| ..)`], [`stream_fill_with(f)`], [`sort()`],
  [`partial_sort(range)`], [`select_nth(index) -> T`], [`dedup() -> usize`], [`reverse()`][218], [`prefix_sum() -> T`][219], [`by::<X>()`][220],
  [`zip(other) -> ZipMut`][221], [`map(f)`][222], [`scan(f)`][223]

# Arithmetic

The operators are `+ - * / % & | ^ ! << >>`, unary `-`, their assigning forms, and `==` for all lanes. The other operand
can be a number or an array: see [`Operand`]. A [`Divisor`] divides many vectors, and its `new` is `None` for zero. There are `Default`, `Sum` and `Product`.

- **All lanes:** [`v.simd_min(other)`], [`v.simd_max(other)`],
  [`v.simd_clamp(min, max)`], [`v.simd_min_relaxed(other)`],
  [`v.simd_max_relaxed(other)`], [`v.simd_clamp_relaxed(min, max)`],
  [`v.abs()`], [`v.abs_diff(other)`], [`v.min_magnitude(other)`],
  [`v.max_magnitude(other)`], [`v.add_sub(other)`],
  [`v.mul_add(mul, add)`], [`v.mul_add_relaxed(mul, add)`],
  [`v.mul_add_sub(mul, other)`], [`v.mul_add_sub_relaxed(mul, other)`],
  [`v.mul_sub_add(mul, other)`], [`v.mul_sub_add_relaxed(mul, other)`],
  [`v.polynomial_relaxed(c)`] of floats
- **Division:** [`v.div_euclid(by)`], [`v.rem_euclid(by)`],
  [`v.div_ceil(by)`], [`v.midpoint(other)`]
- **With overflow and carry:** [`v.overflowing_add(other) -> (V, M)`],
  [`v.overflowing_sub(other) -> (V, M)`], [`v.overflowing_mul(other) -> (V, M)`],
  [`v.carrying_add(other, carry) -> (V, M)`], [`v.borrowing_sub(other, borrow) -> (V, M)`]
- **Saturating and rounding:** [`v.saturating_add(other)`],
  [`v.saturating_sub(other)`], [`v.saturating_neg()`],
  [`v.saturating_abs()`], [`v.midpoint_up(other)`],
  [`v.rounding_shr(count)`], [`v.rounding_shr_relaxed(count)`], [`v.saturating_mul(other)`],
  [`v.saturating_add_signed(other)`],
  [`v.saturating_sub_signed(other)`],
  [`v.saturating_add_unsigned(other)`],
  [`v.saturating_sub_unsigned(other)`]
- **Fixed point:** [`v.mul_q15(other)`], [`v.mul_q15_relaxed(other)`],
  [`v.mul_q15_add(mul, add)`], [`v.mul_q15_add_relaxed(mul, add)`],
  [`v.mul_q31(other)`], [`v.mul_q31_relaxed(other)`],
  [`v.mul_q31_add(mul, add)`], [`v.mul_q31_add_relaxed(mul, add)`],
  [`v.mul_high_doubled(factor)`],
  [`v.mul_high_doubled_relaxed(factor)`],
  [`v.cast_mul_q15_add(other, sum)`]
- **Wider products:** [`v.mul_high(other)`], [`v.widening_mul(other) -> [V; 2]`][276],
  [`v.widening_mul_add(other, sums) -> [V; 2]`][277], [`v.widening_mul_even(other)`],
  [`v.widening_mul_odd(other)`],
  [`v.widening_mul_even_odd(other)`], [`v.cast_mul::<U>(other)`],
  [`v.mul52_low_add(mul, add)`], [`v.mul52_high_add(mul, add)`]
- **Sums of products, also with [`PairSums`]:** [`v.dot::<U>(other)`],
  [`v.dot_add(other, sum)`], [`v.dot_add_relaxed(other, sum)`],
  [`v.saturating_dot(other)`], [`v.saturating_dot_add(other, sum)`],
  [`v.mat_mul_add(other, sum)`],
  [`v.mat_mul_add_relaxed(other, sum)`]
- **Adjacent lanes, also with [`AbsDiffSums`]:** [`v.sum_groups::<U>()`],
  [`v.abs_diff_sum::<U>(other)`], [`v.add_pairs(other)`],
  [`v.sub_pairs(other)`], [`v.prefix_sum()`], [`v.scan(neutral, |a, b| ..)`]
- **All lanes to one:** [`v.reduce_sum() -> T`], [`v.reduce_product() -> T`],
  [`v.reduce_min() -> T`], [`v.reduce_max() -> T`],
  [`v.reduce_min_relaxed() -> T`], [`v.reduce_max_relaxed() -> T`],
  [`v.splat_sum()`], [`v.splat_min()`],
  [`v.splat_max()`], [`v.reduce_and() -> T`], [`v.reduce_or() -> T`],
  [`v.reduce_xor() -> T`], and for several vectors at once [`V::reduce_each([..], |a, b| ..) -> [T; K]`][311]
- **Signs:** [`v.is_negative() -> M`], [`v.neg_if_negative(sign)`],
  [`v.neg_if_negative_relaxed(sign)`] (also for `v * sign.signum()`), [`v.copysign(sign)`],
  [`v.signum()`], [`v.is_positive() -> M`],
  [`v.is_sign_negative() -> M`], [`v.is_sign_positive() -> M`],
  [`v.unsigned_abs()`]

# Floating point

The lanes are [`f16`], [`bf16`], `f32` and `f64`. `has!(fp16)` tells whether `f16` has instructions, for up to 64 lanes. Otherwise, and for `bf16`, each
operation converts to `f32` and back, with the same result, so a longer computation is faster between `widen` and `narrow`.

- **Rounding:** [`v.floor()`], [`v.ceil()`], [`v.trunc()`],
  [`v.round_ties_even()`], [`v.round()`], [`v.fract()`]
- **In a direction, after [`v.rounding(mode) -> Rounding`] with a [`Round`]:** `+ - * /`, [`mul_add(mul, add)`], [`sqrt()`], [`cast::<U>()`]
- **Roots and exponents:** [`v.sqrt()`], [`v.recip()`],
  [`v.recip_relaxed()`], [`v.recip_sqrt()`],
  [`v.recip_sqrt_relaxed()`], [`v.exponent()`],
  [`v.exponent_relaxed()`], [`v.biased_exponent()`],
  [`v.ldexp(exponent)`], [`v.ldexp_relaxed(exponent)`], [`v.ldexp_floor(exponent)`], [`v.ldexp_floor_relaxed(exponent)`], [`v.to_bits()`],
  [`V::from_bits(bits)`], [`v.next_up()`], [`v.next_down()`]
- **NaN and infinity:** [`v.is_nan() -> M`], [`v.is_infinite() -> M`],
  [`v.is_finite() -> M`], [`v.is_normal() -> M`], [`v.is_subnormal() -> M`],
  [`v.minimum(other)`], [`v.maximum(other)`]
- **Functions, which have one result on all targets with `fma`, and one on all without:** [`v.exp()`], [`v.exp2()`], [`v.exp_m1()`],
  [`v.ln()`], [`v.ln_1p()`], [`v.log2()`],
  [`v.log10()`], [`v.powf(y)`], [`v.powi(n)`],
  [`v.cbrt()`], [`v.hypot(other)`], [`v.sin()`],
  [`v.cos()`], [`v.sin_cos() -> (V, V)`], [`v.tan()`],
  [`v.asin()`], [`v.acos()`], [`v.atan()`],
  [`v.atan2(x)`], [`v.sinh()`], [`v.cosh()`],
  [`v.tanh()`], [`v.asinh()`], [`v.acosh()`],
  [`v.atanh()`], [`v.erf()`], [`v.erfc()`],
  [`v.gamma()`], [`v.ln_gamma()`], [`v.log(base)`],
  [`v.to_degrees()`], [`v.to_radians()`]
- **With 16 bits, or 32 for `f64`, and no branch, in 20 to 90% of the time:** [`v.exp_relaxed()`], [`v.exp2_relaxed()`],
  [`v.ln_relaxed()`], [`v.log2_relaxed()`], [`v.powf_relaxed(y)`]
- **Complex numbers:** [`v.complex_conj()`], [`v.complex_mul(other)`],
  [`v.complex_mul_add(other, add)`], [`v.complex_mul_conj(other)`],
  [`v.complex_mul_conj_add(other, add)`],
  [`v.complex_mul_relaxed(other)`],
  [`v.complex_mul_add_relaxed(other, add)`],
  [`v.complex_mul_conj_relaxed(other)`],
  [`v.complex_mul_conj_add_relaxed(other, add)`],
  [`v.add_times_i(other)`], [`v.sub_times_i(other)`]

# Bits

- **Logic:** [`v.bit_select(yes, no)`], [`v.xor3(b, c)`], [`v.majority(b, c)`], [`v.black_box()`],
  [`v.any_bits(bits) -> M`], [`v.all_bits(bits) -> M`]
- **Shifting, besides `<<` and `>>`:** [`v.unbounded_shl(count)`],
  [`v.unbounded_shr(count)`], [`v.funnel_shl(low, count)`],
  [`v.funnel_shr(low, count)`]
- **Rotating and reversing:** [`v.rotate_left(count)`],
  [`v.rotate_right(count)`], [`v.rotate_bytes_from(counts)`],
  [`v.reverse_bits()`], [`v.swap_bytes()`],
  [`v.bit_shuffle(indices)`]
- **Apart and together:** [`v.deposit_bits(mask)`], [`v.extract_bits(mask)`], and for numbers the free functions
  [`deposit_bits(bits, mask) -> T`], [`extract_bits(bits, mask) -> T`]
- **Bits to planes and back, squares of bits:** [`v.bit_planes::<K>() -> [u64; K]`][424], [`V::from_bit_planes(planes)`], [`v.transpose_bits()`]
- **Counting:** [`v.count_ones()`], [`v.leading_zeros()`],
  [`v.trailing_zeros()`], [`v.ilog2()`],
  [`v.count_zeros()`], [`v.leading_ones()`], [`v.trailing_ones()`],
  [`v.bit_width()`], [`v.isolate_lowest_one()`],
  [`v.isolate_highest_one()`], [`v.is_power_of_two() -> M`],
  [`v.next_power_of_two()`]
- **Checksums and bitmasks, as free functions:** [`crc32(state, data) -> u32`], [`crc32c(state, data) -> u32`],
  [`prefix_xor(bits) -> u64`] (fast with `aes`), [`set_bit_positions(bits, first, to) -> usize`]
- **Any GF(2^8), as for RAID-6 and Reed-Solomon, and permutations of bits:** [`LinearMap`], [`galois_nibbles(factor, polynomial) -> [[u8; 16]; 2]`][443], [`galois_matrix(factor, polynomial) -> u64`]
- **Random numbers:** [`Xoshiro`]
- **Ciphers. The rounds of SHA and SM3 are in [`crypto`]:** [`v.carryless_mul_even(other)`],
  [`v.carryless_mul_odd(other)`], [`v.carryless_dot_add(other, sum)`],
  [`v.galois_mul(other)`], [`v.galois_affine(matrix)`],
  [`v.galois_affine_inverse(matrix)`], [`v.aes_round(key)`],
  [`v.aes_last_round(key)`], [`v.aes_round_inv(key)`],
  [`v.aes_last_round_inv(key)`],
  [`v.aes_inv_mix_columns()`],
  [`v.aes_key_gen_assist::<RCON>()`], [`V::aes_encrypt(blocks, keys) -> [V; N]`][459],
  [`V::aes_decrypt(blocks, keys) -> [V; N]`][460], [`V::aes_encrypt_and(blocks, keys, meanwhile) -> [V; N]`][461],
  [`V::aes_decrypt_and(blocks, keys, meanwhile) -> [V; N]`][462], [`v.sm4_rounds4(keys)`],
  [`v.sm4_next_keys(constants)`]

# Masks

Where an operation takes a mask, it also takes its bits or a `bool`: see [`Keep`]. A set is an array or a vector: see [`Members`].

- **Making them, also with a [`ByteSet`] or [`ByteClasses`]:** [`v.simd_eq(other) -> M`],
  [`v.simd_ne(other) -> M`], [`v.simd_lt(other) -> M`], [`v.simd_le(other) -> M`],
  [`v.simd_gt(other) -> M`], [`v.simd_ge(other) -> M`], [`v.within(a..=b) -> M`],
  [`v.is_in(set) -> M`], [`v.is_in_relaxed(set) -> M`], [`v.count_in(set)`], [`M::splat(value)`],
  [`M::first_n(n)`], [`M::from_bitmask(bits)`], [`M::load_bitmask(from)`],
  [`M::repeat_bitmask(bits)`], [`M::from_array(lanes)`], [`v.to_mask() -> M`], [`M::LANES`]
- **ASCII:** [`v.is_ascii() -> M`], [`v.is_ascii_alphabetic() -> M`],
  [`v.is_ascii_alphanumeric() -> M`], [`v.is_ascii_control() -> M`],
  [`v.is_ascii_digit() -> M`], [`v.is_ascii_graphic() -> M`],
  [`v.is_ascii_hexdigit() -> M`], [`v.is_ascii_lowercase() -> M`],
  [`v.is_ascii_octdigit() -> M`], [`v.is_ascii_punctuation() -> M`],
  [`v.is_ascii_uppercase() -> M`], [`v.is_ascii_whitespace() -> M`],
  [`v.eq_ignore_ascii_case(other) -> M`], [`v.to_ascii_lowercase()`],
  [`v.to_ascii_uppercase()`]
- **Asking them:** [`m.any() -> bool`], [`m.all() -> bool`], [`m.none() -> bool`],
  [`m.count() -> usize`], [`m.test(i) -> bool`], [`m.first_set() -> Option<usize>`],
  [`m.last_set() -> Option<usize>`], [`m.first_set_relaxed() -> usize`],
  [`m.last_set_relaxed() -> usize`], [`m.count_before_first() -> usize`],
  [`m.iter() -> Iterator`], [`m.to_bitmask() -> u64`], [`m.store_bitmask(to)`], [`m.to_array() -> array`]
- **Choosing lanes:** [`m.select(yes, no) -> V`], [`m.to_simd::<U>() -> V`]
- **Changing them, besides `& | ^ !`:** [`m.only_first()`],
  [`m.before_first()`], [`m.through_first()`],
  [`m.from_first()`], [`m.shift_elements_left::<K>(next)`],
  [`m.shift_elements_right::<K>(previous)`],
  [`m.shift_elements_left_dyn(n, next)`],
  [`m.shift_elements_right_dyn(n, previous)`], [`m.cast::<U>()`],
  [`m.split() -> [M; 2]`][527], [`m.concat(hi)`], [`m.narrow(hi)`],
  [`m.set(i, value)`], [`m.resize::<X>()`], [`m.reverse()`],
  [`m.rotate_elements_left::<K>()`],
  [`m.rotate_elements_right::<K>()`], [`m.interleave(other) -> [M; 2]`][535],
  [`m.deinterleave(other) -> [M; 2]`][536], [`m.swizzle(|i| ..)`]
- **Moving the chosen lanes together or apart:** [`v.compress(keep)`],
  [`v.compress_relaxed(keep)`], [`v.compress_store(to, keep) -> usize`],
  [`v.compress_store_exact(to, keep) -> usize`], [`v.expand(mask)`], [`v.expand_or(mask, or)`],
  [`v.partition(mask)`], [`V::load_expand(from, enable)`], [`V::load_expand_or(from, enable, or)`]

# Other types of lanes

- **The same bits:** [`v.bitcast::<U>()`], [`v.cast_signed()`],
  [`v.cast_unsigned()`], [`v.resize::<X>()`]
- **The same number of lanes, besides `From` where nothing is lost:** [`v.cast::<U>()`],
  [`v.saturating_cast::<U>()`], [`v.round_cast::<U>()`],
  [`v.cast_relaxed::<U>()`], [`v.round_cast_relaxed::<U>()`]
- **The same width:** [`v.widen::<U>() -> [V; 2]`][556], [`v.widen_even::<U>()`],
  [`v.widen_odd::<U>()`], [`v.saturating_narrow::<U>(upper)`],
  [`v.wrapping_narrow::<U>(upper)`], [`v.narrow::<U>(upper)`], [`v.narrow_even_odd::<U>(odd)`]
- **Floats of 8 bits and less, with a [`Minifloat`]:** [`v.to_minifloat(format)`], [`v.from_minifloat::<U>(format)`]
- **Slices, also of structs that are [`Plain`], of vectors, and of `bool` and enums, which are [`AsBytes`]:** [`bitcast_slice::<U>(values) -> &[U]`][568], [`bitcast_slice_mut(values) -> &mut [U]`][569], [`try_bitcast_slice::<U>(values) -> Option<&[U]>`][661], [`try_bitcast_slice_mut(values) -> Option<&mut [U]>`][662], [`as_bytes(values) -> &[u8]`][570], [`as_bytes_mut(values) -> &mut [u8]`][571], [`as_cells(values) -> &[Cell]`][572]

`V::from(x)` converts from the types of `core::arch`, and `v.into()` to them, if the width is the same. A wider vector goes through `split` and `concat`, or `for_each_part` and `from_parts`. A mask goes through `to_simd` and `to_mask`, or for `__mmask64` and so on through `to_bitmask` and `from_bitmask`.

# Moving lanes

- **Any order that is known at compile time:** [`v.swizzle(|i| ..)`],
  [`v.concat_swizzle(w, |i| ..)`], [`v.swizzle_groups([..])`][575],
  [`v.concat_swizzle_groups(w, [..])`][576]
- **Any order:** [`v.swizzle_dyn(indices)`], [`v.concat_swizzle_dyn(other, indices)`],
  [`v.swizzle_dyn_relaxed(indices)`],
  [`v.concat_swizzle_dyn_relaxed(other, indices)`]
- **Halves and blocks:** [`v.split() -> [V; 2]`][581], [`v.concat(upper)`],
  [`v.concat_halves::<A, B>(w)`], [`v.block::<K>()`],
  [`v.with_block::<K>(b)`], [`V::from_halves([lower, upper])`][586],
  [`V::from_parts(|i| ..)`], [`v.for_each_part(|i, part| ..)`]
- **Orders with a name:** [`v.reverse()`], [`v.swap_pairs()`],
  [`v.interleave(other) -> [V; 2]`][591], [`v.deinterleave(other) -> [V; 2]`][592],
  [`v.interleave4(b, c, d) -> [V; 4]`][593], [`v.transpose_pairs(other) -> [V; 2]`][594],
  [`v.alternate(odd)`], [`v.splat_lane::<K>()`],
  [`v.splat_last()`], [`V::transpose(rows) -> [V; N]`][598],
  [`V::transpose_in_blocks(rows) -> [V; N]`][599], [`V::transpose_blocks(rows) -> [V; N]`][600]
- **Shifts, where left is toward lane 0:** [`v.shift_elements_left::<K>(next)`],
  [`v.shift_elements_right::<K>(previous)`],
  [`v.shift_elements_left_dyn(n, next)`],
  [`v.shift_elements_right_dyn(n, previous)`],
  [`v.rotate_elements_left::<K>()`],
  [`v.rotate_elements_right::<K>()`],
  [`v.rotate_elements_left_dyn(n)`],
  [`v.rotate_elements_right_dyn(n)`]
- **In each block, after [`v.in_blocks() -> InBlocks`]:** [`interleave(other) -> [V; 2]`][610],
  [`deinterleave(other) -> [V; 2]`][611], [`reverse()`][612],
  [`splat_lane::<K>()`][613], [`shift_elements_left::<K>(next)`][614],
  [`shift_elements_right::<K>(previous)`][615],
  [`rotate_elements_left::<K>()`],
  [`rotate_elements_right::<K>()`], [`lookup_bytes(indices)`],
  [`concat_lookup_bytes(other, indices)`],
  [`lookup_bytes_relaxed(indices)`],
  [`concat_lookup_bytes_relaxed(other, indices)`], [`widen::<U>() -> [V; 2]`][622],
  [`saturating_narrow::<U>(upper)`], [`weighted_add(other, [j, k], sums) -> [V; 2]`][660], [`add_pairs(other)`],
  [`sub_pairs(other)`], [`prefix_sum()`][626], [`is_in(set) -> M`],
  [`is_in_relaxed(set) -> M`], [`count_in(set)`], [`sliding_abs_diff_sum::<A, B>(other)`],
  [`shuffled_abs_diff_sum::<ORDER>(other)`]
- **Blocks as lanes, after [`v.as_u128s() -> U128s`]:** [`reverse()`][632],
  [`swap_pairs()`], [`splat_lane::<K>()`][634],
  [`interleave(other) -> [V; 2]`][635], [`transpose_pairs(other) -> [V; 2]`][636],
  [`alternate(odd)`], [`swizzle(|i| ..)`],
  [`concat_swizzle(other, |i| ..)`], [`shift_elements_left::<K>(next)`][640],
  [`shift_elements_right::<K>(previous)`][641], [`simd_eq(other) -> M`][642],
  [`simd_lt(other) -> M`][643], [`simd_min(other)`][644], [`simd_max(other)`][645],
  [`by_upper() -> ByUpper`], [`simd_eq(other) -> M`][647], [`simd_lt(other) -> M`][648],
  [`simd_min(other)`][649], [`simd_max(other)`][650]

# By task

| | |
| --- | --- |
| Big-endian numbers | `load_bytes` and `swap_bytes` |
| Records to planes and back, small matrices | `interleaved`, `load_interleaved` and `store_interleaved`, for up to 16 fields |
| Fields of a few bits | `deposit_bits`, `extract_bits`. To join: `dot` or `saturating_dot` with powers of two. To split: `swizzle_dyn` and `>>`, or `rotate_bytes_from` |
| A few small values as one word | `u16x4::load(e).bitcast::<u64>()[0]`. In all of a vector: `repeat` |
| The sign, a comparison with three results | `signum`, `a.saturating_sub(b).signum()` of signed integers |
| Varints, Stream VByte | `load_low_bytes`, `store_low_bytes`, `low_bytes`. Seven bits a byte: `deposit_bits` |
| Escapes, Latin-1 to UTF-8 | `cast` to `u16` or `u32`, and `low_bytes`. If they are rare or longer: `first_set` and `first_n` |
| CRCs with other polynomials | `carryless_dot_add` |
| `a * j + b * k` of `i16` or bytes into `i32` | `in_blocks().weighted_add` |
| One of a short list | `is_in`, or `ByteSet::of` for many bytes |
| How often a value is in a short list | `count_in` |
| Counts for each bit | Carry-save adders of `xor3` and `majority` |
| Nibbles | `v & 15` and `v >> 4`, and `interleave` if the order counts |
| The sums or maxima of several vectors | `reduce_each` |
| A sum of products that can't wrap | Bytes: `dot_wide` of 65536 at a time. `i16`: `fold` with `dot_add::<i64>` |
| Sums for each channel | `for_each_part(\|i, part\| ..)` |
| The least value and where it is | `position_min`. In a vector: `v.simd_eq(v.splat_min()).first_set()`. In a loop of one's own: a vector of values and one of indices, or both in one integer |
| The greatest magnitude | `abs().to_bits()`, and the greatest of these integers |
| The greatest `k` of many | `partial_sort`. Without a copy of all: `filter_into` by a threshold first |
| Several slices or records in place | `as_cells` |
| A number of slices that is known only at run time | `load_at` of several registers from each, as under [overlap][651] |
| Columns with a bitmap of what is valid or chosen | `bitmask_into` writes it. `selected` to add up or compact, `expand_into` for the way back, `zip_bits` for all else |
| The indices of what matches | `positions`. To memory: `enumerate` and `filter_map_into`, or `set_bit_positions` |
| Structs, newtypes | `#[derive(Plain)]`, `bitcast_slice` to the type of the fields, and `interleaved`. With fields of several types: to `u32` or bytes, and `bitcast` |
| An aligned buffer | A `Vec` of `Aligned<[u8; 64]>` or of vectors, and `bitcast_slice_mut`. On the stack: `Output::new(&mut room.0)` in `Aligned([MaybeUninit::uninit(); N])` |
| Several rows that are shorter than a vector | `Rows`, `load_row` and `store_row`. Without AVX-512, `load_short` for steps lane by lane |
| Records by index | `gather_interleaved(all.as_flattened(), i * 4)`, and `gather_windows` for larger ones |
| A search in sorted values | `count` of `simd_lt`, after a binary search down to a few vectors |
| Intersections of sorted lists | `is_in` with a reference to an array, and `compress_store` or `selected` |
| Differences and their sums, recurrences | `windows`; `prefix_sum` or `scan` in `scan_into`. Zigzag is `v << 1 ^ v >> 31` |
| The bits of a slice, Hamming distances | `fold` with `count_ones`: of `u64` if `has!(icelake)`, and otherwise of bytes, with `sum_groups`. To `u16` it is one instruction on NEON, for up to 4095 vectors |
| Decimal digits | `saturating_dot` with 10 and 1, `dot` with 100 and 1, and so on |
| Filters and convolutions | `windows` or `load_at`, with `mul_add_relaxed` or `dot_add`. With a step: `over_all` of the slice at several offsets. To decimate, return fewer lanes |
| Complex numbers of `i16` | `a.dot::<i32>(b.alternate(-b))` and `a.dot::<i32>(b.swap_pairs())`, and then `rounding_shr`, `interleave` and `saturating_narrow` |
| Even and odd lanes of integers back together | `even.bitcast().alternate((odd << 16).bitcast())` |
| Products modulo a number | `mul_high` or `mul_q15` for 16 bits, `widening_mul_even` and `_odd` for 32, `mul52_*` for up to 50, and on Intel also for 32 |
| A carry from lane to lane | Add the bitmasks of the lanes that overflow and of those that are all ones |
| Fields of bits at computed places | `gather_bytes` at `bit >> 3`, and `>> (bit & 7)` |
| A table in registers | `indices.lookup(&array)`, `table.swizzle_dyn(indices)` for a vector and `concat_swizzle_dyn` for two, with zero outside (for bytes `tbl` as it is), `indices.lookup_or(&table.to_array(), or)` with another value (for bytes `tbx`), `table.in_blocks().lookup_bytes(indices)` for `pshufb` as it is. For sums over many vectors: one table for each byte of the values |

# What has no name

- **The compiler joins it:** `!a & b` (and-not), two operators of logic in a row (`vpternlog`), `a.mul_add_relaxed(b, -c)` and `(-a).mul_add_relaxed(b, c)`,
  a comparison and `&` of masks, `m.select(a + b, a)` (masked operations), `(a & b).simd_eq(0).all()` (`ptest`), a load as an operand.
- **On NEON too:** `a << 4 | b & 15` (`sli`), `a & 0xf800 | b >> 5` (`sri`), `((v + 8) >> 4).cast::<u8>()` (`rshrn`), `v.rounding_shr(n).saturating_cast()` (`sqrshrn`), `((a - b) >> 8).cast::<u8>()` (`subhn`, `addhn`),
  `simd_min` of the two results of `in_blocks().deinterleave` (`uminp`). If it doesn't join them, see [what LLVM undoes][652].
- **The rules of x86, on all targets:** `minps` is `a.simd_lt(b).select(a, b)`, and `maxps` the same with `simd_gt`. Both take two instructions or more there, and the `_relaxed` forms one. `cvttps2dq` is `v.abs().simd_lt(2147483648.0).select(v.cast_relaxed(), i32::MIN)`.
  To flush subnormal numbers to zero: `v.is_subnormal().select(v & -0.0, v)`.
- **Faster in plain Rust on most CPUs:** histograms, and adding at indices that can repeat. `vpconflict` takes about 20 cycles on Intel.
- **Words for lists of targets**, such as `fast_gather`: see [`simd`][1]. In each file with kernels: [`targets!`].
- **What differs by target:** [`has!`], [`pick!`][655], and for types [`Pick!`][656] and [`Either!`]. `if has!(avx2 + gfni)`, `pick! { neon => a, _ => b }`, `Pick![S: avx512 => B64, _ => B32]`, and `#[only(avx2)]` on one of two functions with one name. A module of helpers takes the list of its callers: `#[simd(crate::kernels)]`.
- **A pointer to the version that was chosen, tables of functions, objects with a target:** a kernel returns them. See [larger programs][658].
