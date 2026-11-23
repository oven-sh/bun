
[1]: macro@crate::simd
[`kernel`]: macro@crate::kernel
[3]: crate::Simd
[`Mask`]: crate::Mask
[`MaskOf`]: crate::MaskOf
[`V::splat(value)`]: crate::Simd::splat
[`V::zero()`]: crate::Simd::zero
[`V::iota(first)`]: crate::Simd::iota
[`V::from(value)`]: crate::Simd::from
[`V::from_array(lanes)`]: crate::Simd::from_array
[`V::from_fn(|i| ..)`]: crate::Simd::from_fn
[12]: crate::Simd::repeat
[`V::sign_bit()`]: crate::Simd::sign_bit
[`V::LANES`]: crate::Simd::LANES
[`S::REGISTERS`]: crate::Isa::REGISTERS
[`Baseline`]: crate::target::Baseline
[`V::load(from)`]: crate::Simd::load
[`V::load_at(from, at)`]: crate::Simd::load_at
[`V::load_last(from)`]: crate::Simd::load_last
[`V::load_bytes(from)`]: crate::Simd::load_bytes
[`V::load_block(from)`]: crate::Simd::load_block
[`v.store(to)`]: crate::Simd::store
[`v.store_at(to, at)`]: crate::Simd::store_at
[`v.store_last(to)`]: crate::Simd::store_last
[`v.store_bytes(to)`]: crate::Simd::store_bytes
[30]: crate::mem::ChunkAt::chunk_at
[31]: crate::mem::ChunkAt::chunk_at_mut
[`ChunkAt`]: crate::mem::ChunkAt
[663]: crate::mem::SubArray::sub_array
[664]: crate::mem::SubArray::sub_array_mut
[`SubArray`]: crate::mem::SubArray
[665]: crate::mem::FlatArray::flat_array
[666]: crate::mem::FlatArray::flat_array_mut
[`FlatArray`]: crate::mem::FlatArray
[`V::load_or_default(from)`]: crate::Simd::load_or_default
[`V::load_or(from, or)`]: crate::Simd::load_or
[`V::load_padded(from, pad)`]: crate::Simd::load_padded
[`V::load_row(rows, y)`]: crate::Simd::load_row
[`v.store_row(rows, y)`]: crate::Simd::store_row
[`V::load_short(from)`]: crate::Simd::load_short
[`V::load_select(from, enable, or)`]: crate::Simd::load_select
[`V::load_select_or_default(from, enable)`]: crate::Simd::load_select_or_default
[`v.store_partial(to)`]: crate::Simd::store_partial
[`v.store_partial_at(to, at)`]: crate::Simd::store_partial_at
[`v.store_short(to)`]: crate::Simd::store_short
[`v.store_select(to, enable)`]: crate::Simd::store_select
[45]: crate::Simd::load_interleaved
[46]: crate::Simd::store_interleaved
[47]: crate::Simd::load_interleaved_or_default
[`V::store_interleaved_partial(vectors, to)`]: crate::Simd::store_interleaved_partial
[`V::load_3_of_4(from)`]: crate::Simd::load_3_of_4
[`v.store_3_of_4(to)`]: crate::Simd::store_3_of_4
[`V::load_low_bytes(from, more) -> (V, usize)`]: crate::Simd::load_low_bytes
[`v.store_low_bytes(to, more) -> usize`]: crate::Simd::store_low_bytes
[`V::gather_or(table, indices, or)`]: crate::Simd::gather_or
[`V::gather_or_default(table, indices)`]: crate::Simd::gather_or_default
[`V::gather_select(table, enable, indices, or)`]: crate::Simd::gather_select
[56]: crate::Simd::gather_interleaved
[`V::gather_bytes(from, offsets)`]: crate::Simd::gather_bytes
[58]: crate::Simd::gather_windows
[`v.scatter(table, indices)`]: crate::Simd::scatter
[`v.scatter_select(table, enable, indices)`]: crate::Simd::scatter_select
[`v.lookup(table)`]: crate::Simd::lookup
[`v.lookup_relaxed(table)`]: crate::Simd::lookup_relaxed
[`v.lookup_or(table, or)`]: crate::Simd::lookup_or
[64]: crate::array::from_fn
[65]: crate::array::map
[`unroll!`]: crate::unroll
[`not_unrolled()`]: crate::not_unrolled
[`Output`]: crate::mem::Output
[`out.push(piece)`]: crate::mem::Output::push
[`out.try_push(piece) -> Option<()>`]: crate::mem::Output::try_push
[`out.push_with_slack(piece)`]: crate::mem::Output::push_with_slack
[`Piece`]: crate::mem::Piece
[`v.first_n(n) -> FirstN`]: crate::Simd::first_n
[`v.selected(keep) -> SelectedLanes`]: crate::Simd::selected
[`v.low_bytes(more) -> LowBytes`]: crate::Simd::low_bytes
[`v.ascii() -> AsAscii`]: crate::Simd::ascii
[`out.push_at(v, at)`]: crate::mem::Output::push_at
[`out.push_one(value)`]: crate::mem::Output::push_one
[76]: crate::mem::Output::push_array
[`set_bit_positions(bits, first, to) -> usize`]: crate::prelude::set_bit_positions
[`out.extend_from_back(distance, n) -> Option<()>`]: crate::mem::Output::extend_from_back
[`out.room_for(n) -> Option<Room>`]: crate::mem::Output::room_for
[`Room`]: crate::mem::Room
[`out.limit(n) -> Appending`]: crate::mem::Output::limit
[`out.streams(each, |outs| ..) -> R`]: crate::mem::Output::streams
[`Output::append(to, room) -> Appending`]: crate::mem::Output::append
[`Output::resume(to, history, room) -> Appending`]: crate::mem::Output::resume
[`Output::overwrite(to)`]: crate::mem::Output::overwrite
[`Output::new(to)`]: crate::mem::Output::new
[89]: crate::mem::Output::filled
[90]: crate::mem::Output::filled_mut
[91]: crate::mem::Output::into_filled
[`out.truncate(len)`]: crate::mem::Output::truncate
[`out.clear()`]: crate::mem::Output::clear
[94]: crate::mem::prefetch
[`prefetch_with(values, at, how)`]: crate::mem::prefetch_with
[96]: crate::mem::Prefetch
[`Aligned`]: crate::mem::Aligned
[`Rows`]: crate::mem::Rows
[`RowsMut`]: crate::mem::RowsMut
[`Rows::new(values, stride, width, height)`]: crate::mem::Rows::new
[`rows.at(x, y, width, height)`]: crate::mem::Rows::at
[659]: crate::mem::Rows::row
[`split_at_row(y) -> (RowsMut, RowsMut)`]: crate::mem::RowsMut::split_at_row
[`split_at_column(x) -> (RowsMut, RowsMut)`]: crate::mem::RowsMut::split_at_column
[102]: crate::mem::RowsMut::rows_mut
[103]: crate::mem::streaming
[`s.lend(to)`]: crate::mem::Streaming::lend
[105]: crate::mem::Streaming
[`Streamed`]: crate::mem::Streamed
[`Lendable`]: crate::mem::Lendable
[`Shared`]: crate::mem::Shared
[`Appendable`]: crate::mem::Appendable
[`Part`]: crate::mem::Part
[`Readable`]: crate::mem::Readable
[`Writable`]: crate::mem::Writable
[`Slice`]: crate::mem::Slice
[`SliceMut`]: crate::mem::SliceMut
[`Sink`]: crate::mem::Sink
[`to.part(range) -> Part`]: crate::mem::Sink::part
[`part.skip(n)`]: crate::mem::Part::skip
[`part.write(at, values)`]: crate::mem::Part::write
[`v.to_array() -> array`]: crate::Simd::to_array
[`v.lane::<K>() -> T`]: crate::Simd::lane
[`v.lane_dyn(i) -> T`]: crate::Simd::lane_dyn
[`v.with_lane::<K>(x)`]: crate::Simd::with_lane
[`v.with_lane_dyn(i, x)`]: crate::Simd::with_lane_dyn
[`V::over(values) -> Over`]: crate::Simd::over
[`V::over_mut(values) -> OverMut`]: crate::Simd::over_mut
[123]: crate::Over::exact
[124]: crate::Over::padded
[125]: crate::Over::by
[126]: crate::Over::pad
[127]: crate::Over::position
[128]: crate::Over::rposition
[129]: crate::Over::positions
[`position_of_any(set) -> Option<usize>`]: crate::Over::position_of_any
[131]: crate::Over::any
[132]: crate::Over::all
[133]: crate::Over::count
[134]: crate::Over::counts
[`bitmask(|v| m) -> u64`]: crate::Over::bitmask
[136]: crate::Over::bitmask_into
[`is_sorted() -> bool`]: crate::Over::is_sorted
[`cmp(other) -> Ordering`]: crate::Over::cmp
[139]: crate::text::Utf8
[`Ascii`]: crate::text::Ascii
[`to_str() -> Result<&str>`]: crate::Over::to_str
[142]: crate::Over::utf8
[`from_utf8(bytes) -> Result<&str>`]: crate::text::from_utf8
[`string_from_utf8(bytes) -> Result<String>`]: crate::text::string_from_utf8
[145]: crate::Over::map_into
[146]: crate::Over::scan_into
[147]: crate::Over::unzip_into
[`map_until(to, stop, f) -> usize`]: crate::Over::map_until
[`filter_into(to, |v| m) -> usize`]: crate::Over::filter_into
[150]: crate::Over::filter_map_into
[151]: crate::Over::stream_into
[152]: crate::Over::fold
[153]: crate::Over::sum
[`sum_wide() -> u64 or i64`]: crate::Over::sum_wide
[`sum_relaxed() -> T`]: crate::Over::sum_relaxed
[155]: crate::Over::min
[`min_relaxed() -> Option<T>`]: crate::Over::min_relaxed
[157]: crate::Over::max
[`max_relaxed() -> Option<T>`]: crate::Over::max_relaxed
[`min_max() -> Option<(T, T)>`]: crate::Over::min_max
[`position_min() -> Option<usize>`]: crate::Over::position_min
[`position_max() -> Option<usize>`]: crate::Over::position_max
[`mat_vec(x, to)`]: crate::Over::mat_vec
[`mat_vec_relaxed(x, to)`]: crate::Over::mat_vec_relaxed
[`Columns`]: crate::Columns
[165]: crate::Over::zip
[166]: crate::Over::zip_scaled
[`V::over_all(slices) -> Columns`]: crate::Simd::over_all
[`windows::<K>() -> Columns`]: crate::Over::windows
[`interleaved::<K>() -> Columns`]: crate::Over::interleaved
[170]: crate::Columns::zip
[171]: crate::Columns::zip_scaled
[172]: crate::Columns::pad
[`len() -> usize`]: crate::Columns::len
[`is_empty() -> bool`]: crate::Columns::is_empty
[175]: crate::Columns::exact
[176]: crate::Columns::padded
[177]: crate::Columns::position
[178]: crate::Columns::rposition
[179]: crate::Columns::positions
[180]: crate::Columns::any
[181]: crate::Columns::all
[182]: crate::Columns::count
[183]: crate::Columns::counts
[184]: crate::Columns::bitmask_into
[185]: crate::Columns::fold
[186]: crate::Columns::map_into
[187]: crate::Columns::scan_into
[188]: crate::Columns::unzip_into
[189]: crate::Columns::filter_map_into
[190]: crate::Columns::stream_into
[191]: crate::Over::enumerate
[192]: crate::Over::zip_bits
[`expand_into(to, bits, fill) -> usize`]: crate::Over::expand_into
[194]: crate::Over::selected
[195]: crate::Columns::enumerate
[196]: crate::Columns::zip_bits
[197]: crate::Columns::selected
[198]: crate::Selected
[199]: crate::Selected::count
[200]: crate::Selected::fold
[201]: crate::Selected::sum
[202]: crate::Selected::min
[203]: crate::Selected::max
[204]: crate::Selected::map_into
[`dot() -> T`]: crate::Columns::dot
[`dot_relaxed() -> T`]: crate::Columns::dot_relaxed
[`dot_wide() -> i32 or u32`]: crate::Columns::dot_wide
[`dot_wide_relaxed() -> f32`]: crate::Columns::dot_wide_relaxed
[209]: crate::OverMut::map
[210]: crate::OverMut::scan
[`retain(|v| m) -> usize`]: crate::OverMut::retain
[`fill_with(|indices| ..)`]: crate::OverMut::fill_with
[`stream_fill_with(f)`]: crate::OverMut::stream_fill_with
[`sort()`]: crate::OverMut::sort
[`partial_sort(range)`]: crate::OverMut::partial_sort
[`select_nth(index) -> T`]: crate::OverMut::select_nth
[`dedup() -> usize`]: crate::OverMut::dedup
[218]: crate::OverMut::reverse
[219]: crate::OverMut::prefix_sum
[220]: crate::OverMut::by
[221]: crate::OverMut::zip
[222]: crate::ZipMut::map
[223]: crate::ZipMut::scan
[`Operand`]: crate::Operand
[`Divisor`]: crate::math::Divisor
[`v.simd_min(other)`]: crate::Simd::simd_min
[`v.simd_max(other)`]: crate::Simd::simd_max
[`v.simd_clamp(min, max)`]: crate::Simd::simd_clamp
[`v.simd_min_relaxed(other)`]: crate::Simd::simd_min_relaxed
[`v.simd_max_relaxed(other)`]: crate::Simd::simd_max_relaxed
[`v.simd_clamp_relaxed(min, max)`]: crate::Simd::simd_clamp_relaxed
[`v.abs()`]: crate::Simd::abs
[`v.abs_diff(other)`]: crate::Simd::abs_diff
[`v.min_magnitude(other)`]: crate::Simd::min_magnitude
[`v.max_magnitude(other)`]: crate::Simd::max_magnitude
[`v.add_sub(other)`]: crate::Simd::add_sub
[`v.mul_add(mul, add)`]: crate::Simd::mul_add
[`v.mul_add_relaxed(mul, add)`]: crate::Simd::mul_add_relaxed
[`v.mul_add_sub(mul, other)`]: crate::Simd::mul_add_sub
[`v.mul_add_sub_relaxed(mul, other)`]: crate::Simd::mul_add_sub_relaxed
[`v.mul_sub_add(mul, other)`]: crate::Simd::mul_sub_add
[`v.mul_sub_add_relaxed(mul, other)`]: crate::Simd::mul_sub_add_relaxed
[`v.polynomial_relaxed(c)`]: crate::Simd::polynomial_relaxed
[`v.div_euclid(by)`]: crate::Simd::div_euclid
[`v.rem_euclid(by)`]: crate::Simd::rem_euclid
[`v.div_ceil(by)`]: crate::Simd::div_ceil
[`v.midpoint(other)`]: crate::Simd::midpoint
[`v.overflowing_add(other) -> (V, M)`]: crate::Simd::overflowing_add
[`v.overflowing_sub(other) -> (V, M)`]: crate::Simd::overflowing_sub
[`v.overflowing_mul(other) -> (V, M)`]: crate::Simd::overflowing_mul
[`v.carrying_add(other, carry) -> (V, M)`]: crate::Simd::carrying_add
[`v.borrowing_sub(other, borrow) -> (V, M)`]: crate::Simd::borrowing_sub
[`v.saturating_add(other)`]: crate::Simd::saturating_add
[`v.saturating_sub(other)`]: crate::Simd::saturating_sub
[`v.saturating_neg()`]: crate::Simd::saturating_neg
[`v.saturating_abs()`]: crate::Simd::saturating_abs
[`v.midpoint_up(other)`]: crate::Simd::midpoint_up
[`v.rounding_shr(count)`]: crate::Simd::rounding_shr
[`v.rounding_shr_relaxed(count)`]: crate::Simd::rounding_shr_relaxed
[`v.saturating_mul(other)`]: crate::Simd::saturating_mul
[`v.saturating_add_signed(other)`]: crate::Simd::saturating_add_signed
[`v.saturating_sub_signed(other)`]: crate::Simd::saturating_sub_signed
[`v.saturating_add_unsigned(other)`]: crate::Simd::saturating_add_unsigned
[`v.saturating_sub_unsigned(other)`]: crate::Simd::saturating_sub_unsigned
[`v.mul_q15(other)`]: crate::Simd::mul_q15
[`v.mul_q15_relaxed(other)`]: crate::Simd::mul_q15_relaxed
[`v.mul_q15_add(mul, add)`]: crate::Simd::mul_q15_add
[`v.mul_q15_add_relaxed(mul, add)`]: crate::Simd::mul_q15_add_relaxed
[`v.mul_q31(other)`]: crate::Simd::mul_q31
[`v.mul_q31_relaxed(other)`]: crate::Simd::mul_q31_relaxed
[`v.mul_q31_add(mul, add)`]: crate::Simd::mul_q31_add
[`v.mul_q31_add_relaxed(mul, add)`]: crate::Simd::mul_q31_add_relaxed
[`v.mul_high_doubled(factor)`]: crate::Simd::mul_high_doubled
[`v.mul_high_doubled_relaxed(factor)`]: crate::Simd::mul_high_doubled_relaxed
[`v.cast_mul_q15_add(other, sum)`]: crate::Simd::cast_mul_q15_add
[`v.mul_high(other)`]: crate::Simd::mul_high
[276]: crate::Simd::widening_mul
[277]: crate::Simd::widening_mul_add
[`v.widening_mul_even(other)`]: crate::Simd::widening_mul_even
[`v.widening_mul_odd(other)`]: crate::Simd::widening_mul_odd
[`v.widening_mul_even_odd(other)`]: crate::Simd::widening_mul_even_odd
[`v.cast_mul::<U>(other)`]: crate::Simd::cast_mul
[`v.mul52_low_add(mul, add)`]: crate::Simd::mul52_low_add
[`v.mul52_high_add(mul, add)`]: crate::Simd::mul52_high_add
[`PairSums`]: crate::math::PairSums
[`v.dot::<U>(other)`]: crate::Simd::dot
[`v.dot_add(other, sum)`]: crate::Simd::dot_add
[`v.dot_add_relaxed(other, sum)`]: crate::Simd::dot_add_relaxed
[`v.saturating_dot(other)`]: crate::Simd::saturating_dot
[`v.saturating_dot_add(other, sum)`]: crate::Simd::saturating_dot_add
[`v.mat_mul_add(other, sum)`]: crate::Simd::mat_mul_add
[`v.mat_mul_add_relaxed(other, sum)`]: crate::Simd::mat_mul_add_relaxed
[`AbsDiffSums`]: crate::math::AbsDiffSums
[`v.sum_groups::<U>()`]: crate::Simd::sum_groups
[`v.abs_diff_sum::<U>(other)`]: crate::Simd::abs_diff_sum
[`v.add_pairs(other)`]: crate::Simd::add_pairs
[`v.sub_pairs(other)`]: crate::Simd::sub_pairs
[`v.prefix_sum()`]: crate::Simd::prefix_sum
[`v.scan(neutral, |a, b| ..)`]: crate::Simd::scan
[`v.reduce_sum() -> T`]: crate::Simd::reduce_sum
[`v.reduce_product() -> T`]: crate::Simd::reduce_product
[`v.reduce_min() -> T`]: crate::Simd::reduce_min
[`v.reduce_max() -> T`]: crate::Simd::reduce_max
[`v.reduce_min_relaxed() -> T`]: crate::Simd::reduce_min_relaxed
[`v.reduce_max_relaxed() -> T`]: crate::Simd::reduce_max_relaxed
[`v.splat_sum()`]: crate::Simd::splat_sum
[`v.splat_min()`]: crate::Simd::splat_min
[`v.splat_max()`]: crate::Simd::splat_max
[`v.reduce_and() -> T`]: crate::Simd::reduce_and
[`v.reduce_or() -> T`]: crate::Simd::reduce_or
[`v.reduce_xor() -> T`]: crate::Simd::reduce_xor
[311]: crate::Simd::reduce_each
[`v.is_negative() -> M`]: crate::Simd::is_negative
[`v.neg_if_negative(sign)`]: crate::Simd::neg_if_negative
[`v.neg_if_negative_relaxed(sign)`]: crate::Simd::neg_if_negative_relaxed
[`v.copysign(sign)`]: crate::Simd::copysign
[`v.signum()`]: crate::Simd::signum
[`v.is_positive() -> M`]: crate::Simd::is_positive
[`v.is_sign_negative() -> M`]: crate::Simd::is_sign_negative
[`v.is_sign_positive() -> M`]: crate::Simd::is_sign_positive
[`v.unsigned_abs()`]: crate::Simd::unsigned_abs
[`f16`]: crate::f16
[`bf16`]: crate::bf16
[`v.floor()`]: crate::Simd::floor
[`v.ceil()`]: crate::Simd::ceil
[`v.trunc()`]: crate::Simd::trunc
[`v.round_ties_even()`]: crate::Simd::round_ties_even
[`v.round()`]: crate::Simd::round
[`v.fract()`]: crate::Simd::fract
[`v.rounding(mode) -> Rounding`]: crate::Simd::rounding
[`Round`]: crate::math::Round
[`mul_add(mul, add)`]: crate::Rounding::mul_add
[`sqrt()`]: crate::Rounding::sqrt
[`cast::<U>()`]: crate::Rounding::cast
[`v.sqrt()`]: crate::Simd::sqrt
[`v.recip()`]: crate::Simd::recip
[`v.recip_relaxed()`]: crate::Simd::recip_relaxed
[`v.recip_sqrt()`]: crate::Simd::recip_sqrt
[`v.recip_sqrt_relaxed()`]: crate::Simd::recip_sqrt_relaxed
[`v.exponent()`]: crate::Simd::exponent
[`v.exponent_relaxed()`]: crate::Simd::exponent_relaxed
[`v.biased_exponent()`]: crate::Simd::biased_exponent
[`v.ldexp(exponent)`]: crate::Simd::ldexp
[`v.ldexp_relaxed(exponent)`]: crate::Simd::ldexp_relaxed
[`v.ldexp_floor(exponent)`]: crate::Simd::ldexp_floor
[`v.ldexp_floor_relaxed(exponent)`]: crate::Simd::ldexp_floor_relaxed
[`v.to_bits()`]: crate::Simd::to_bits
[`V::from_bits(bits)`]: crate::Simd::from_bits
[`v.next_up()`]: crate::Simd::next_up
[`v.next_down()`]: crate::Simd::next_down
[`v.is_nan() -> M`]: crate::Simd::is_nan
[`v.is_infinite() -> M`]: crate::Simd::is_infinite
[`v.is_finite() -> M`]: crate::Simd::is_finite
[`v.is_normal() -> M`]: crate::Simd::is_normal
[`v.is_subnormal() -> M`]: crate::Simd::is_subnormal
[`v.minimum(other)`]: crate::Simd::minimum
[`v.maximum(other)`]: crate::Simd::maximum
[`v.exp()`]: crate::Simd::exp
[`v.exp2()`]: crate::Simd::exp2
[`v.exp_m1()`]: crate::Simd::exp_m1
[`v.ln()`]: crate::Simd::ln
[`v.ln_1p()`]: crate::Simd::ln_1p
[`v.log2()`]: crate::Simd::log2
[`v.log10()`]: crate::Simd::log10
[`v.powf(y)`]: crate::Simd::powf
[`v.powi(n)`]: crate::Simd::powi
[`v.cbrt()`]: crate::Simd::cbrt
[`v.hypot(other)`]: crate::Simd::hypot
[`v.sin()`]: crate::Simd::sin
[`v.cos()`]: crate::Simd::cos
[`v.sin_cos() -> (V, V)`]: crate::Simd::sin_cos
[`v.tan()`]: crate::Simd::tan
[`v.asin()`]: crate::Simd::asin
[`v.acos()`]: crate::Simd::acos
[`v.atan()`]: crate::Simd::atan
[`v.atan2(x)`]: crate::Simd::atan2
[`v.sinh()`]: crate::Simd::sinh
[`v.cosh()`]: crate::Simd::cosh
[`v.tanh()`]: crate::Simd::tanh
[`v.asinh()`]: crate::Simd::asinh
[`v.acosh()`]: crate::Simd::acosh
[`v.atanh()`]: crate::Simd::atanh
[`v.erf()`]: crate::Simd::erf
[`v.erfc()`]: crate::Simd::erfc
[`v.gamma()`]: crate::Simd::gamma
[`v.ln_gamma()`]: crate::Simd::ln_gamma
[`v.log(base)`]: crate::Simd::log
[`v.to_degrees()`]: crate::Simd::to_degrees
[`v.to_radians()`]: crate::Simd::to_radians
[`v.exp_relaxed()`]: crate::Simd::exp_relaxed
[`v.exp2_relaxed()`]: crate::Simd::exp2_relaxed
[`v.ln_relaxed()`]: crate::Simd::ln_relaxed
[`v.log2_relaxed()`]: crate::Simd::log2_relaxed
[`v.powf_relaxed(y)`]: crate::Simd::powf_relaxed
[`v.complex_conj()`]: crate::Simd::complex_conj
[`v.complex_mul(other)`]: crate::Simd::complex_mul
[`v.complex_mul_add(other, add)`]: crate::Simd::complex_mul_add
[`v.complex_mul_conj(other)`]: crate::Simd::complex_mul_conj
[`v.complex_mul_conj_add(other, add)`]: crate::Simd::complex_mul_conj_add
[`v.complex_mul_relaxed(other)`]: crate::Simd::complex_mul_relaxed
[`v.complex_mul_add_relaxed(other, add)`]: crate::Simd::complex_mul_add_relaxed
[`v.complex_mul_conj_relaxed(other)`]: crate::Simd::complex_mul_conj_relaxed
[`v.complex_mul_conj_add_relaxed(other, add)`]: crate::Simd::complex_mul_conj_add_relaxed
[`v.add_times_i(other)`]: crate::Simd::add_times_i
[`v.sub_times_i(other)`]: crate::Simd::sub_times_i
[`v.bit_select(yes, no)`]: crate::Simd::bit_select
[`v.xor3(b, c)`]: crate::Simd::xor3
[`v.majority(b, c)`]: crate::Simd::majority
[`v.black_box()`]: crate::Simd::black_box
[`v.any_bits(bits) -> M`]: crate::Simd::any_bits
[`v.all_bits(bits) -> M`]: crate::Simd::all_bits
[`v.unbounded_shl(count)`]: crate::Simd::unbounded_shl
[`v.unbounded_shr(count)`]: crate::Simd::unbounded_shr
[`v.funnel_shl(low, count)`]: crate::Simd::funnel_shl
[`v.funnel_shr(low, count)`]: crate::Simd::funnel_shr
[`v.rotate_left(count)`]: crate::Simd::rotate_left
[`v.rotate_right(count)`]: crate::Simd::rotate_right
[`v.rotate_bytes_from(counts)`]: crate::Simd::rotate_bytes_from
[`v.reverse_bits()`]: crate::Simd::reverse_bits
[`v.swap_bytes()`]: crate::Simd::swap_bytes
[`v.bit_shuffle(indices)`]: crate::Simd::bit_shuffle
[`v.deposit_bits(mask)`]: crate::Simd::deposit_bits
[`v.extract_bits(mask)`]: crate::Simd::extract_bits
[`deposit_bits(bits, mask) -> T`]: crate::prelude::deposit_bits
[`extract_bits(bits, mask) -> T`]: crate::prelude::extract_bits
[424]: crate::Simd::bit_planes
[`V::from_bit_planes(planes)`]: crate::Simd::from_bit_planes
[`v.transpose_bits()`]: crate::Simd::transpose_bits
[`v.count_ones()`]: crate::Simd::count_ones
[`v.leading_zeros()`]: crate::Simd::leading_zeros
[`v.trailing_zeros()`]: crate::Simd::trailing_zeros
[`v.ilog2()`]: crate::Simd::ilog2
[`v.count_zeros()`]: crate::Simd::count_zeros
[`v.leading_ones()`]: crate::Simd::leading_ones
[`v.trailing_ones()`]: crate::Simd::trailing_ones
[`v.bit_width()`]: crate::Simd::bit_width
[`v.isolate_lowest_one()`]: crate::Simd::isolate_lowest_one
[`v.isolate_highest_one()`]: crate::Simd::isolate_highest_one
[`v.is_power_of_two() -> M`]: crate::Simd::is_power_of_two
[`v.next_power_of_two()`]: crate::Simd::next_power_of_two
[`crc32(state, data) -> u32`]: crate::prelude::crc32
[`crc32c(state, data) -> u32`]: crate::prelude::crc32c
[`prefix_xor(bits) -> u64`]: crate::prelude::prefix_xor
[`LinearMap`]: crate::math::LinearMap
[443]: crate::math::galois_nibbles
[`galois_matrix(factor, polynomial) -> u64`]: crate::math::galois_matrix
[`Xoshiro`]: crate::math::Xoshiro
[`crypto`]: crate::crypto
[`v.carryless_mul_even(other)`]: crate::Simd::carryless_mul_even
[`v.carryless_mul_odd(other)`]: crate::Simd::carryless_mul_odd
[`v.carryless_dot_add(other, sum)`]: crate::Simd::carryless_dot_add
[`v.galois_mul(other)`]: crate::Simd::galois_mul
[`v.galois_affine(matrix)`]: crate::Simd::galois_affine
[`v.galois_affine_inverse(matrix)`]: crate::Simd::galois_affine_inverse
[`v.aes_round(key)`]: crate::Simd::aes_round
[`v.aes_last_round(key)`]: crate::Simd::aes_last_round
[`v.aes_round_inv(key)`]: crate::Simd::aes_round_inv
[`v.aes_last_round_inv(key)`]: crate::Simd::aes_last_round_inv
[`v.aes_inv_mix_columns()`]: crate::Simd::aes_inv_mix_columns
[`v.aes_key_gen_assist::<RCON>()`]: crate::Simd::aes_key_gen_assist
[459]: crate::Simd::aes_encrypt
[460]: crate::Simd::aes_decrypt
[461]: crate::Simd::aes_encrypt_and
[462]: crate::Simd::aes_decrypt_and
[`v.sm4_rounds4(keys)`]: crate::Simd::sm4_rounds4
[`v.sm4_next_keys(constants)`]: crate::Simd::sm4_next_keys
[`Keep`]: crate::Keep
[`Members`]: crate::Members
[`ByteSet`]: crate::text::ByteSet
[`ByteClasses`]: crate::text::ByteClasses
[`v.simd_eq(other) -> M`]: crate::Simd::simd_eq
[`v.simd_ne(other) -> M`]: crate::Simd::simd_ne
[`v.simd_lt(other) -> M`]: crate::Simd::simd_lt
[`v.simd_le(other) -> M`]: crate::Simd::simd_le
[`v.simd_gt(other) -> M`]: crate::Simd::simd_gt
[`v.simd_ge(other) -> M`]: crate::Simd::simd_ge
[`v.within(a..=b) -> M`]: crate::Simd::within
[`v.is_in(set) -> M`]: crate::Simd::is_in
[`v.is_in_relaxed(set) -> M`]: crate::Simd::is_in_relaxed
[`v.count_in(set)`]: crate::Simd::count_in
[`M::splat(value)`]: crate::Mask::splat
[`M::first_n(n)`]: crate::Mask::first_n
[`M::from_bitmask(bits)`]: crate::Mask::from_bitmask
[`M::load_bitmask(from)`]: crate::Mask::load_bitmask
[`M::repeat_bitmask(bits)`]: crate::Mask::repeat_bitmask
[`M::from_array(lanes)`]: crate::Mask::from_array
[`v.to_mask() -> M`]: crate::Simd::to_mask
[`M::LANES`]: crate::Mask::LANES
[`v.is_ascii() -> M`]: crate::Simd::is_ascii
[`v.is_ascii_alphabetic() -> M`]: crate::Simd::is_ascii_alphabetic
[`v.is_ascii_alphanumeric() -> M`]: crate::Simd::is_ascii_alphanumeric
[`v.is_ascii_control() -> M`]: crate::Simd::is_ascii_control
[`v.is_ascii_digit() -> M`]: crate::Simd::is_ascii_digit
[`v.is_ascii_graphic() -> M`]: crate::Simd::is_ascii_graphic
[`v.is_ascii_hexdigit() -> M`]: crate::Simd::is_ascii_hexdigit
[`v.is_ascii_lowercase() -> M`]: crate::Simd::is_ascii_lowercase
[`v.is_ascii_octdigit() -> M`]: crate::Simd::is_ascii_octdigit
[`v.is_ascii_punctuation() -> M`]: crate::Simd::is_ascii_punctuation
[`v.is_ascii_uppercase() -> M`]: crate::Simd::is_ascii_uppercase
[`v.is_ascii_whitespace() -> M`]: crate::Simd::is_ascii_whitespace
[`v.eq_ignore_ascii_case(other) -> M`]: crate::Simd::eq_ignore_ascii_case
[`v.to_ascii_lowercase()`]: crate::Simd::to_ascii_lowercase
[`v.to_ascii_uppercase()`]: crate::Simd::to_ascii_uppercase
[`m.any() -> bool`]: crate::Mask::any
[`m.all() -> bool`]: crate::Mask::all
[`m.none() -> bool`]: crate::Mask::none
[`m.count() -> usize`]: crate::Mask::count
[`m.test(i) -> bool`]: crate::Mask::test
[`m.first_set() -> Option<usize>`]: crate::Mask::first_set
[`m.last_set() -> Option<usize>`]: crate::Mask::last_set
[`m.first_set_relaxed() -> usize`]: crate::Mask::first_set_relaxed
[`m.last_set_relaxed() -> usize`]: crate::Mask::last_set_relaxed
[`m.count_before_first() -> usize`]: crate::Mask::count_before_first
[`m.iter() -> Iterator`]: crate::Mask::iter
[`m.to_bitmask() -> u64`]: crate::Mask::to_bitmask
[`m.store_bitmask(to)`]: crate::Mask::store_bitmask
[`m.to_array() -> array`]: crate::Mask::to_array
[`m.select(yes, no) -> V`]: crate::Mask::select
[`m.to_simd::<U>() -> V`]: crate::Mask::to_simd
[`m.only_first()`]: crate::Mask::only_first
[`m.before_first()`]: crate::Mask::before_first
[`m.through_first()`]: crate::Mask::through_first
[`m.from_first()`]: crate::Mask::from_first
[`m.shift_elements_left::<K>(next)`]: crate::Mask::shift_elements_left
[`m.shift_elements_right::<K>(previous)`]: crate::Mask::shift_elements_right
[`m.shift_elements_left_dyn(n, next)`]: crate::Mask::shift_elements_left_dyn
[`m.shift_elements_right_dyn(n, previous)`]: crate::Mask::shift_elements_right_dyn
[`m.cast::<U>()`]: crate::Mask::cast
[527]: crate::Mask::split
[`m.concat(hi)`]: crate::Mask::concat
[`m.narrow(hi)`]: crate::Mask::narrow
[`m.set(i, value)`]: crate::Mask::set
[`m.resize::<X>()`]: crate::Mask::resize
[`m.reverse()`]: crate::Mask::reverse
[`m.rotate_elements_left::<K>()`]: crate::Mask::rotate_elements_left
[`m.rotate_elements_right::<K>()`]: crate::Mask::rotate_elements_right
[535]: crate::Mask::interleave
[536]: crate::Mask::deinterleave
[`m.swizzle(|i| ..)`]: crate::Mask::swizzle
[`v.compress(keep)`]: crate::Simd::compress
[`v.compress_relaxed(keep)`]: crate::Simd::compress_relaxed
[`v.compress_store(to, keep) -> usize`]: crate::Simd::compress_store
[`v.compress_store_exact(to, keep) -> usize`]: crate::Simd::compress_store_exact
[`v.expand(mask)`]: crate::Simd::expand
[`v.expand_or(mask, or)`]: crate::Simd::expand_or
[`v.partition(mask)`]: crate::Simd::partition
[`V::load_expand(from, enable)`]: crate::Simd::load_expand
[`V::load_expand_or(from, enable, or)`]: crate::Simd::load_expand_or
[`v.bitcast::<U>()`]: crate::Simd::bitcast
[`v.cast_signed()`]: crate::Simd::cast_signed
[`v.cast_unsigned()`]: crate::Simd::cast_unsigned
[`v.resize::<X>()`]: crate::Simd::resize
[`v.cast::<U>()`]: crate::Simd::cast
[`v.saturating_cast::<U>()`]: crate::Simd::saturating_cast
[`v.round_cast::<U>()`]: crate::Simd::round_cast
[`v.cast_relaxed::<U>()`]: crate::Simd::cast_relaxed
[`v.round_cast_relaxed::<U>()`]: crate::Simd::round_cast_relaxed
[556]: crate::Simd::widen
[`v.widen_even::<U>()`]: crate::Simd::widen_even
[`v.widen_odd::<U>()`]: crate::Simd::widen_odd
[`v.saturating_narrow::<U>(upper)`]: crate::Simd::saturating_narrow
[`v.wrapping_narrow::<U>(upper)`]: crate::Simd::wrapping_narrow
[`v.narrow::<U>(upper)`]: crate::Simd::narrow
[`v.narrow_even_odd::<U>(odd)`]: crate::Simd::narrow_even_odd
[`Minifloat`]: crate::math::Minifloat
[`v.to_minifloat(format)`]: crate::Simd::to_minifloat
[`v.from_minifloat::<U>(format)`]: crate::Simd::from_minifloat
[`Plain`]: trait@crate::mem::Plain
[`AsBytes`]: trait@crate::mem::AsBytes
[568]: crate::mem::bitcast_slice
[569]: crate::mem::bitcast_slice_mut
[661]: crate::mem::try_bitcast_slice
[662]: crate::mem::try_bitcast_slice_mut
[570]: crate::mem::as_bytes
[571]: crate::mem::as_bytes_mut
[572]: crate::mem::as_cells
[`v.swizzle(|i| ..)`]: crate::Simd::swizzle
[`v.concat_swizzle(w, |i| ..)`]: crate::Simd::concat_swizzle
[575]: crate::Simd::swizzle_groups
[576]: crate::Simd::concat_swizzle_groups
[`v.swizzle_dyn(indices)`]: crate::Simd::swizzle_dyn
[`v.concat_swizzle_dyn(other, indices)`]: crate::Simd::concat_swizzle_dyn
[`v.swizzle_dyn_relaxed(indices)`]: crate::Simd::swizzle_dyn_relaxed
[`v.concat_swizzle_dyn_relaxed(other, indices)`]: crate::Simd::concat_swizzle_dyn_relaxed
[581]: crate::Simd::split
[`v.concat(upper)`]: crate::Simd::concat
[`v.concat_halves::<A, B>(w)`]: crate::Simd::concat_halves
[`v.block::<K>()`]: crate::Simd::block
[`v.with_block::<K>(b)`]: crate::Simd::with_block
[586]: crate::Simd::from_halves
[`V::from_parts(|i| ..)`]: crate::Simd::from_parts
[`v.for_each_part(|i, part| ..)`]: crate::Simd::for_each_part
[`v.reverse()`]: crate::Simd::reverse
[`v.swap_pairs()`]: crate::Simd::swap_pairs
[591]: crate::Simd::interleave
[592]: crate::Simd::deinterleave
[593]: crate::Simd::interleave4
[594]: crate::Simd::transpose_pairs
[`v.alternate(odd)`]: crate::Simd::alternate
[`v.splat_lane::<K>()`]: crate::Simd::splat_lane
[`v.splat_last()`]: crate::Simd::splat_last
[598]: crate::Simd::transpose
[599]: crate::Simd::transpose_in_blocks
[600]: crate::Simd::transpose_blocks
[`v.shift_elements_left::<K>(next)`]: crate::Simd::shift_elements_left
[`v.shift_elements_right::<K>(previous)`]: crate::Simd::shift_elements_right
[`v.shift_elements_left_dyn(n, next)`]: crate::Simd::shift_elements_left_dyn
[`v.shift_elements_right_dyn(n, previous)`]: crate::Simd::shift_elements_right_dyn
[`v.rotate_elements_left::<K>()`]: crate::Simd::rotate_elements_left
[`v.rotate_elements_right::<K>()`]: crate::Simd::rotate_elements_right
[`v.rotate_elements_left_dyn(n)`]: crate::Simd::rotate_elements_left_dyn
[`v.rotate_elements_right_dyn(n)`]: crate::Simd::rotate_elements_right_dyn
[`v.in_blocks() -> InBlocks`]: crate::Simd::in_blocks
[610]: crate::InBlocks::interleave
[611]: crate::InBlocks::deinterleave
[612]: crate::InBlocks::reverse
[613]: crate::InBlocks::splat_lane
[614]: crate::InBlocks::shift_elements_left
[615]: crate::InBlocks::shift_elements_right
[`rotate_elements_left::<K>()`]: crate::InBlocks::rotate_elements_left
[`rotate_elements_right::<K>()`]: crate::InBlocks::rotate_elements_right
[`lookup_bytes(indices)`]: crate::InBlocks::lookup_bytes
[`concat_lookup_bytes(other, indices)`]: crate::InBlocks::concat_lookup_bytes
[`lookup_bytes_relaxed(indices)`]: crate::InBlocks::lookup_bytes_relaxed
[`concat_lookup_bytes_relaxed(other, indices)`]: crate::InBlocks::concat_lookup_bytes_relaxed
[622]: crate::InBlocks::widen
[`saturating_narrow::<U>(upper)`]: crate::InBlocks::saturating_narrow
[660]: crate::InBlocks::weighted_add
[`add_pairs(other)`]: crate::InBlocks::add_pairs
[`sub_pairs(other)`]: crate::InBlocks::sub_pairs
[626]: crate::InBlocks::prefix_sum
[`is_in(set) -> M`]: crate::InBlocks::is_in
[`is_in_relaxed(set) -> M`]: crate::InBlocks::is_in_relaxed
[`count_in(set)`]: crate::InBlocks::count_in
[`sliding_abs_diff_sum::<A, B>(other)`]: crate::InBlocks::sliding_abs_diff_sum
[`shuffled_abs_diff_sum::<ORDER>(other)`]: crate::InBlocks::shuffled_abs_diff_sum
[`v.as_u128s() -> U128s`]: crate::Simd::as_u128s
[632]: crate::U128s::reverse
[`swap_pairs()`]: crate::U128s::swap_pairs
[634]: crate::U128s::splat_lane
[635]: crate::U128s::interleave
[636]: crate::U128s::transpose_pairs
[`alternate(odd)`]: crate::U128s::alternate
[`swizzle(|i| ..)`]: crate::U128s::swizzle
[`concat_swizzle(other, |i| ..)`]: crate::U128s::concat_swizzle
[640]: crate::U128s::shift_elements_left
[641]: crate::U128s::shift_elements_right
[642]: crate::U128s::simd_eq
[643]: crate::U128s::simd_lt
[644]: crate::U128s::simd_min
[645]: crate::U128s::simd_max
[`by_upper() -> ByUpper`]: crate::U128s::by_upper
[647]: crate::ByUpper::simd_eq
[648]: crate::ByUpper::simd_lt
[649]: crate::ByUpper::simd_min
[650]: crate::ByUpper::simd_max
[651]: crate::guide::speed#overlap
[652]: crate::guide::speed#what-llvm-undoes
[`targets!`]: macro@crate::targets
[`has!`]: macro@crate::has
[655]: macro@crate::pick
[656]: macro@crate::Pick
[`Either!`]: macro@crate::Either
[658]: crate::guide::programs
