//! `zstd_ldm.c`: long distance matching.

use super::internal::{
    BlockSrc, Buffers, CompressionParameters, DictTableLoadMethod, HASH_READ_SIZE, LdmEntry,
    LdmParams, LdmState, MatchState, ParamSwitch, Prefix, RawSeq, RawSeqStore, SeqStore, Strategy,
    TableFillPurpose, count, count_2segments, offset_to_offbase,
};
use super::{compress_block, double_fast, fast};
use crate::common::ZSTD_REP_NUM;
use crate::common::xxhash::Xxh64;
use crate::error::{ErrorCode, Result};
use crate::util::{BUG, SliceExt};

const ZSTD_HASHLOG_MIN: u32 = 6;
const ZSTD_HASHLOG_MAX: u32 = 30;
const ZSTD_LDM_BUCKETSIZELOG_MAX: u32 = 8;

const LDM_BUCKET_SIZE_LOG: u32 = 4;
const LDM_MIN_MATCH_LENGTH: u32 = 64;
const LDM_BATCH_SIZE: usize = 64;

/// `ZSTD_ldm_gearTab`
#[rustfmt::skip]
static GEAR_TAB: [u64; 256] = [
    0xf5b8_f72c_5f77_775c, 0x8493_5f26_6b7a_c412, 0xb647_ada9_ca73_0ccc, 0xb065_bb4b_114f_b1de,
    0x3458_4e7e_8c3a_9fd0, 0x4e97_e17c_6ae2_6b05, 0x3a03_d743_bc99_a604, 0xcecd_0424_22c4_044f,
    0x76de_76c5_8524_259e, 0x9c85_28f6_5bad_eaca, 0x8656_3706_e209_7529, 0x2902_475f_a375_d889,
    0xafb3_2a97_39a5_ebe6, 0xce27_14da_3883_e639, 0x021e_af82_1722_e69e, 0x0003_7b62_8620_b628,
    0x049a_8d45_5d88_caf5, 0x8556_d711_e695_8140, 0x04f7_ae74_fc60_5c1f, 0x829f_0c34_68bd_3a20,
    0x4ffd_c885_c625_179e, 0x8473_de04_8a3d_af1b, 0x5100_8822_b056_46b2, 0x69d7_5d12_b2d1_cc5f,
    0x8c9d_4a19_1591_54bc, 0xc3cc_10f4_abbd_4003, 0xd06d_dc1c_ecb9_7391, 0xbe48_e6e7_ed80_302e,
    0x3481_db31_cee0_3547, 0xacc3_f67c_daa1_d210, 0x65cb_771d_8c7f_96cc, 0x8eb2_7177_0557_23dd,
    0xc789_950d_44cd_94be, 0x934f_eadc_3700_b12b, 0x5e48_5f11_edbd_f182, 0x1e2e_2a46_fd64_767a,
    0x2969_ca71_d82e_fa7c, 0x9d46_e993_5ebb_ba2e, 0xe056_b67e_05e6_822b, 0x94d7_3f55_739d_03a0,
    0xcd70_10bd_b69b_5a03, 0x455e_f9fc_d79b_82f4, 0x869c_b54a_8749_c161, 0x38d1_a4fa_6185_d225,
    0xb475_166f_94bb_e9bb, 0xa414_3548_7209_59f1, 0x7aed_4780_ba6b_26ba, 0xd0ce_2644_39e0_2312,
    0x8436_6d74_6078_d508, 0xa8ce_973c_72ed_17be, 0x21c3_23a2_9a43_0b01, 0x9962_d617_e3af_80ee,
    0xab0c_e91d_9c8c_f75b, 0x530e_8ee6_d19a_4dbc, 0x2ef6_8c0c_f53f_5d72, 0xc03a_6816_40a8_5506,
    0x496e_4e9f_9c31_0967, 0x7858_0472_b59b_14a0, 0x2738_24c2_3b38_8577, 0x66bf_923a_d45c_b553,
    0x47ae_1a5a_2492_ba86, 0x35e3_0456_9e22_9659, 0x4765_182a_4687_0b6f, 0x6cba_b625_e909_9412,
    0xddac_9a2e_5985_22c1, 0x7172_086e_6666_24f2, 0xdf50_03ca_503b_7837, 0x88c0_c1db_7856_3d09,
    0x58d5_1865_acfc_289d, 0x1776_71ae_c652_24f1, 0xfb79_d8a2_41e9_67d7, 0x2be1_e101_cad9_a49a,
    0x6625_682f_6e29_186b, 0x3995_5345_7ac0_6e50, 0x035d_ffb4_c23a_bb74, 0x429d_b259_1f54_aade,
    0xc528_02a8_037d_1009, 0x6acb_2738_1f0b_25f3, 0xf45e_2551_ee4f_823b, 0x8b0e_a2d9_9580_c2f7,
    0x3bed_519c_bcb4_e1e1, 0x0ff4_5282_3dbb_010a, 0x9d42_ed61_4f3d_d267, 0x5b93_13c0_6257_c57b,
    0xa114_b800_8b5e_1442, 0xc1fe_311c_11c1_3d4b, 0x66e8_763e_a34c_5568, 0x8b98_2af1_c262_f05d,
    0xee88_76fa_aa75_fbb7, 0x8a62_a4d0_d172_bb2a, 0xc13d_94a3_b744_9a97, 0x6dbb_ba9d_c15d_037c,
    0xc786_101f_1d92_e0f1, 0xd786_81a9_07a0_b79b, 0xf61a_af29_62c9_abb9, 0x2cfd_16fc_d3cb_7ad9,
    0x868c_5b67_4462_4d21, 0x25e6_5089_9c74_ddd7, 0xba04_2af4_a7c3_7463, 0x4eb1_a539_465a_3eca,
    0xbe09_dbf0_3b05_d5ca, 0x774e_5a36_2b54_72ba, 0x47a1_2212_29d1_83cd, 0x504b_0ca1_8ef5_a2df,
    0xdffb_dfbd_e245_6eb9, 0x46cd_2b2f_bee3_4634, 0xf2ae_f8fe_819d_98c3, 0x357f_5276_d459_9d61,
    0x24a5_4838_79c4_53e3, 0x0880_2688_9192_b4b9, 0x28da_9667_1782_dbec, 0x4ef3_7c40_588e_9aaa,
    0x8837_b906_51bc_9fb3, 0xc164_f741_d3f0_e5d6, 0xbc13_5a0a_704b_70ba, 0x069c_d868_f762_2ada,
    0xbc37_ba89_e0b9_c0ab, 0x47c1_4a01_3235_52f6, 0x4f00_794b_acee_98bb, 0x7107_de7d_637a_69d5,
    0x88af_793b_b6f2_255e, 0xf3c6_466b_8799_b598, 0xc288_c616_aa7f_3b59, 0x81ca_63cf_42fc_a3fd,
    0x88d8_5ace_36a2_674b, 0x0d05_6bd3_7923_89e7, 0xe55c_396c_4e9d_d32d, 0xbefb_5045_71e6_c0a6,
    0x96ab_3211_5e91_e8cc, 0xbf8a_cb18_de8f_38d1, 0x66da_e588_0167_2606, 0x833b_6017_8723_17fb,
    0xb87c_16f2_d1c9_2864, 0xdb76_6a74_e58b_669c, 0x8965_9f85_c614_17be, 0xc8da_ad85_6011_ea0c,
    0x76a4_b565_b6fe_7eae, 0xa469_d085_f623_7312, 0xaaf0_3656_83a3_e96c, 0x4dbb_746f_8424_f7b8,
    0x0638_755a_f4e4_acc1, 0x3d78_07f5_bde6_4486, 0x17be_6d8f_5bbb_7639, 0x0903_f0cd_44dc_35dc,
    0x67b6_72ea_fdf1_196c, 0xa676_ff93_ed4c_82f1, 0x521d_1004_c505_3d9d, 0x37ba_9ad0_9ccc_9202,
    0x84e5_4d29_7aac_fb51, 0x0a0b_4b77_6a14_3445, 0x0820_d471_e20b_348e, 0x1874_383c_b83d_46dc,
    0x97ed_eec7_a1ef_e11c, 0xb330_e50b_1bdc_42aa, 0x1dd9_1955_ce70_e032, 0xa514_cdb8_8f29_39d5,
    0x2791_233f_d90d_b9d3, 0x7b67_0a4c_c50f_7a9b, 0x77c0_7d2a_05c6_dfa5, 0xe377_8b66_46d0_a6fa,
    0xb39c_8eda_47b5_6749, 0x933e_d448_addb_ef28, 0xaf84_6af6_ab7d_0bf4, 0x0e5a_f208_eb66_6e49,
    0x5e66_22f7_3534_cd6a, 0x297d_aeca_42ef_5b6e, 0x862d_aef3_d355_39a6, 0xe687_2249_8f8e_1ea9,
    0x981c_5309_3dc0_d572, 0xfa09_b0bf_bf86_fbf5, 0x30b1_e961_6621_9f15, 0x70e7_d466_bdc4_fb83,
    0x5a66_736e_35f2_a8e9, 0xcddb_59d2_b7c1_baef, 0xd6c7_d247_d26d_8996, 0xea4e_39ea_c8de_1ba3,
    0x539c_8bb1_9fa3_aff2, 0x09f9_0e4c_5fd5_08d8, 0xa34e_5956_fbaf_3385, 0x2e2f_8e15_1d3e_f375,
    0x1736_91e9_b83f_aec1, 0xb85a_8d56_bf01_6379, 0x8382_3812_6740_8ae3, 0xb90f_901b_bdc0_096d,
    0x7c6a_d329_33bc_ec65, 0x76bb_5e2f_2c8a_d595, 0x390f_851a_6cf4_6d28, 0xc3e6_064d_a1c2_da72,
    0xc52a_0c10_1cfa_5389, 0xd78e_af84_a3fb_c530, 0x3781_b9e2_288b_997e, 0x73c2_f6de_a83d_05c4,
    0x0422_8e36_4c5b_5ed7, 0x9d7a_3edf_0da4_3911, 0x8edc_feda_2468_6756, 0x5e76_67a7_b7a9_b3a1,
    0x4c4f_389f_a143_791d, 0xb08b_c102_3da7_cddc, 0x7ab4_be3a_e529_b1cc, 0x754e_6132_dbe7_4ff9,
    0x7163_5442_a839_df45, 0x2f6f_b164_3fbe_52de, 0x961e_0a42_cf7a_8177, 0xf3b4_5d83_d89e_f2ea,
    0xee3d_e4cf_4a6e_3e9b, 0xcd68_4854_2c32_95e7, 0xe4ce_e166_4c78_662f, 0x9947_548b_474c_68c4,
    0x25d7_3777_a5ed_8b0b, 0x00c9_15b1_d636_b7fc, 0x21c2_ba75_d9b0_d2da, 0x5f6b_5dcf_608a_64a1,
    0xdcf3_3325_5ff9_570c, 0x633b_9224_18ce_d4ee, 0xc136_dde0_b004_b34a, 0x58cc_83b0_5d4b_2f5a,
    0x5eb4_24dd_a28e_42d2, 0x62df_4736_9739_cd98, 0xb4e0_b424_85e4_ce17, 0x16e1_f0c1_f9a8_d1e7,
    0x8ec3_9167_0756_0ebf, 0x62ba_6e2d_f2cc_9db3, 0xcbf9_f4ff_77d8_3a16, 0x78d9_d7d0_7d2b_bcc4,
    0xef55_4ce1_e02c_41f4, 0x8d75_8112_7ecc_f94d, 0xa9b5_3336_cb3c_8a05, 0x38c4_2c0b_f45c_4f91,
    0x6408_93cd_f448_8863, 0x80ec_34bc_575e_a568, 0x39f3_24f5_b48e_aa40, 0xe9d9_ed1f_8eff_527f,
    0x9224_fc05_8cc5_a214, 0xbaba_00b0_4cfe_7741, 0x309a_9f12_0fcf_52af, 0xa558_f3ec_6562_6212,
    0x424b_ec8b_7ada_be2f, 0x4162_2513_a6ae_a433, 0xb88d_a2d5_324c_a798, 0xd287_733b_2455_28a4,
    0x9a44_697e_6d68_aec3, 0x7b10_93be_2f49_bb28, 0x50bb_ec63_2e3d_8aad, 0x6cd9_0723_e1ea_8283,
    0x897b_9e74_31b0_2bf3, 0x219e_fdcb_338a_7047, 0x3b03_11f0_a27c_0656, 0xdb17_bf91_c0db_96e7,
    0x8cd4_fd6b_4e85_a5b2, 0xfab0_7105_4ba6_409d, 0x40d6_fe83_1fa9_dfd9, 0xaf35_8deb_ad7d_791e,
    0xeb8d_0e25_a65e_3e58, 0xbbcb_d3df_14e0_8580, 0x0cf7_51f2_7ecd_ab2b, 0x2b4d_a14f_2613_d8f4,
];

/// `ldmRollingHashState_t`
struct RollingHashState {
    rolling: u64,
    stop_mask: u64,
}

impl RollingHashState {
    /// `ZSTD_ldm_gear_init`
    fn new(params: &LdmParams) -> Self {
        let max_bits_in_mask = params.min_match_length.min(64);
        let hash_rate_log = params.hash_rate_log;
        let rate_mask = (1u64 << (hash_rate_log & 63)) - 1;
        // A split is to happen every `1 << hash_rate_log` bytes on average, and bit n of the hash depends on the last
        // n bytes: the mask has the highest bits that depend on no more than `min_match_length` bytes.
        let stop_mask = if hash_rate_log > 0 && hash_rate_log <= max_bits_in_mask {
            rate_mask << ((max_bits_in_mask - hash_rate_log) & 63)
        } else {
            rate_mask
        };
        Self {
            rolling: u64::from(u32::MAX),
            stop_mask,
        }
    }

    /// `ZSTD_ldm_gear_feed`: writes to `splits` the split points of `data`, as positions in it. Stops at the end of
    /// `data` or once `splits` is full. Returns how many bytes it went through, and how many splits it found.
    #[inline]
    fn feed(&mut self, data: &[u8], splits: &mut [usize; LDM_BATCH_SIZE]) -> (usize, usize) {
        let mut hash = self.rolling;
        let mask = self.stop_mask;
        let mut n = 0usize;
        let mut num_splits = 0usize;
        // Returns whether `splits` is full.
        let mut iter_once = |byte: u8| {
            let gear = GEAR_TAB.get(usize::from(byte)).copied().unwrap_or(0);
            hash = (hash << 1).wrapping_add(gear);
            n += 1;
            if hash & mask == 0 {
                if let Some(split) = splits.get_mut(num_splits) {
                    *split = n;
                }
                num_splits += 1;
                return num_splits == LDM_BATCH_SIZE;
            }
            false
        };
        let (quads, rest) = data.as_chunks::<4>();
        let full = quads
            .iter()
            .any(|&[a, b, c, d]| iter_once(a) || iter_once(b) || iter_once(c) || iter_once(d));
        if !full {
            for &byte in rest {
                if iter_once(byte) {
                    break;
                }
            }
        }
        self.rolling = hash;
        (n, num_splits)
    }
}

/// `XXH64`, with a seed of 0.
#[inline]
fn xxh64(data: &[u8]) -> u64 {
    let mut state = Xxh64::new();
    state.update(data);
    state.digest()
}

/// `ZSTD_ldm_adjustParameters`: gives a value to the parameters that are 0. `c_params` are those that are applied.
pub(crate) fn adjust_parameters(params: &mut LdmParams, c_params: &CompressionParameters) {
    let strategy = c_params.strat();
    params.window_log = c_params.window_log;
    if params.hash_rate_log == 0 {
        if params.hash_log > 0 {
            if params.window_log > params.hash_log {
                params.hash_rate_log = params.window_log - params.hash_log;
            }
        } else {
            // From 7 for `fast` to 4 for `btultra2`.
            params.hash_rate_log = 7 - (strategy as u32 / 3);
        }
    }
    if params.hash_log == 0 {
        params.hash_log = params
            .window_log
            .wrapping_sub(params.hash_rate_log)
            .clamp(ZSTD_HASHLOG_MIN, ZSTD_HASHLOG_MAX);
    }
    if params.min_match_length == 0 {
        params.min_match_length = LDM_MIN_MATCH_LENGTH;
        if strategy >= Strategy::BtUltra {
            params.min_match_length /= 2;
        }
    }
    if params.bucket_size_log == 0 {
        params.bucket_size_log =
            (strategy as u32).clamp(LDM_BUCKET_SIZE_LOG, ZSTD_LDM_BUCKETSIZELOG_MAX);
    }
    params.bucket_size_log = params.bucket_size_log.min(params.hash_log);
}

/// `ZSTD_ldm_getMaxNbSeq`: the most sequences that `max_chunk_size` bytes can give.
pub(crate) fn get_max_nb_seq(params: LdmParams, max_chunk_size: usize) -> usize {
    if params.enable_ldm == ParamSwitch::Enable {
        max_chunk_size
            .checked_div(params.min_match_length as usize)
            .unwrap_or(0)
    } else {
        0
    }
}

/// The mask that keeps, of a hash, the number of a bucket.
#[inline]
const fn bucket_mask(params: &LdmParams) -> u32 {
    (1u32 << (params.hash_log.wrapping_sub(params.bucket_size_log) & 31)) - 1
}

/// `ZSTD_ldm_getBucket`: where the bucket `hash` starts in the hash table.
#[inline(always)]
const fn get_bucket(hash: usize, bucket_size_log: u32) -> usize {
    hash << (bucket_size_log & 31)
}

/// `ZSTD_ldm_insertEntry`: in place of the oldest entry of the bucket `hash`.
#[inline]
fn insert_entry(
    ldm_state: &mut LdmState,
    hash: usize,
    entry: LdmEntry,
    bucket_size_log: u32,
) -> Result<()> {
    let p_offset = ldm_state.bucket_offsets.at_mut(hash)?;
    let offset = u32::from(*p_offset);
    *p_offset = ((offset + 1) & ((1u32 << (bucket_size_log & 31)) - 1)) as u8;
    ldm_state
        .hash_table
        .put(get_bucket(hash, bucket_size_log) + offset as usize, entry)
}

/// `ZSTD_ldm_countBackwardsMatch`: how many bytes before `p_in` in `buf`, down to `p_anchor`, are the same as those
/// before `p_match` in `match_buf`, down to `p_match_base`.
#[inline]
fn count_backwards_match(
    buf: &[u8],
    p_in: usize,
    p_anchor: usize,
    match_buf: &[u8],
    p_match: usize,
    p_match_base: usize,
) -> Result<usize> {
    Ok(buf
        .sub(p_anchor..p_in)?
        .iter()
        .rev()
        .zip(match_buf.sub(p_match_base..p_match)?.iter().rev())
        .take_while(|(in_byte, match_byte)| in_byte == match_byte)
        .count())
}

/// `ZSTD_ldm_countBackwardsMatch_2segments`, for a match in the current segment, which starts at `p_match_base`: from
/// there, the match goes on at the end of the older segment. A match in the older segment has nowhere to go on.
#[inline]
fn count_backwards_match_2segments(
    buf: &[u8],
    p_in: usize,
    p_anchor: usize,
    p_match: usize,
    p_match_base: usize,
    dict_buf: &[u8],
    p_ext_dict_start: usize,
    p_ext_dict_end: usize,
) -> Result<usize> {
    let match_length = count_backwards_match(buf, p_in, p_anchor, buf, p_match, p_match_base)?;
    if p_match - match_length != p_match_base {
        return Ok(match_length);
    }
    Ok(match_length
        + count_backwards_match(
            buf,
            p_in - match_length,
            p_anchor,
            dict_buf,
            p_ext_dict_end,
            p_ext_dict_start,
        )?)
}

/// `ZSTD_ldm_fillFastTables`: the strategies that index only what they search have to be told about what they skip.
fn fill_fast_tables(ms: &mut MatchState, prefix: Prefix<'_>, end: usize) -> Result<()> {
    match ms.c_params.strat() {
        Strategy::Fast => fast::fill_hash_table(
            ms,
            prefix,
            end,
            DictTableLoadMethod::Fast,
            TableFillPurpose::ForCCtx,
        ),
        Strategy::DFast => double_fast::fill_double_hash_table(
            ms,
            prefix,
            end,
            DictTableLoadMethod::Fast,
            TableFillPurpose::ForCCtx,
        ),
        Strategy::Greedy
        | Strategy::Lazy
        | Strategy::Lazy2
        | Strategy::BtLazy2
        | Strategy::BtOpt
        | Strategy::BtUltra
        | Strategy::BtUltra2 => Ok(()),
    }
}

/// `ZSTD_ldm_fillHashTable`: indexes the content of a dictionary, which is `prefix.buf` from `ip` to `iend`.
pub(crate) fn fill_hash_table(
    ldm_state: &mut LdmState,
    prefix: Prefix<'_>,
    mut ip: usize,
    iend: usize,
    params: &LdmParams,
) -> Result<()> {
    let min_match_length = params.min_match_length as usize;
    let bucket_mask = bucket_mask(params);
    let istart = ip;
    let mut hash_state = RollingHashState::new(params);
    let mut splits = [0usize; LDM_BATCH_SIZE];

    while ip < iend {
        let (hashed, num_splits) = hash_state.feed(prefix.buf.sub(ip..iend)?, &mut splits);
        for &split in splits.iter().take(num_splits) {
            if ip + split >= istart + min_match_length {
                let split = ip + split - min_match_length;
                let xxhash = xxh64(prefix.buf.span(split, min_match_length)?);
                let hash = xxhash as u32 & bucket_mask;
                let entry = LdmEntry {
                    offset: prefix.index_of(split),
                    checksum: (xxhash >> 32) as u32,
                };
                insert_entry(ldm_state, hash as usize, entry, params.bucket_size_log)?;
            }
        }
        ip += hashed;
    }
    Ok(())
}

/// `ZSTD_ldm_limitTableUpdate`: if the tables of `ms` are far behind `anchor`, skips most of the way.
fn limit_table_update(ms: &mut MatchState, src: &BlockSrc<'_>, anchor: usize) {
    let curr = src.index_of(anchor);
    if curr > ms.next_to_update.wrapping_add(1024) {
        let behind = curr.wrapping_sub(ms.next_to_update).wrapping_sub(1024);
        ms.next_to_update = curr.wrapping_sub(behind.min(512));
    }
}

/// `ldmMatchCandidate_t`
#[derive(Clone, Copy, Default)]
struct MatchCandidate {
    split: usize,
    hash: u32,
    checksum: u32,
    /// Where the bucket starts in the hash table.
    bucket: usize,
}

/// `ZSTD_ldm_generateSequences_internal`: the input is from `istart` to `iend` in the buffer of the current segment.
/// Returns how many bytes at its end are in no sequence.
fn generate_sequences_internal(
    ldm_state: &mut LdmState,
    raw_seq_store: &mut RawSeqStore,
    params: &LdmParams,
    bufs: &Buffers<'_>,
    istart: usize,
    iend: usize,
) -> Result<usize> {
    let window = ldm_state.window;
    let ext_dict = window.has_ext_dict();
    let min_match_length = params.min_match_length as usize;
    let ents_per_bucket = 1usize << (params.bucket_size_log & 31);
    let bucket_mask = bucket_mask(params);
    let dict_limit = window.dict_limit;
    let lowest_index = if ext_dict {
        window.low_limit
    } else {
        dict_limit
    };
    let prefix = Prefix {
        buf: bufs.get(window.base_buf),
        base: window.base.wrapping_sub(window.base_buf.start()),
    };
    let buf = prefix.buf;
    let dict_buf = bufs.get(window.dict_buf);
    let dict_base = window.dict_base.wrapping_sub(window.dict_buf.start());
    let dict_start = dict_base.wrapping_add(lowest_index as usize);
    let dict_end = dict_base.wrapping_add(dict_limit as usize);
    let low_prefix = prefix.pos_of(dict_limit);
    let ilimit = iend.saturating_sub(HASH_READ_SIZE);
    let mut anchor = istart;
    let mut ip = istart;
    let mut splits = [0usize; LDM_BATCH_SIZE];
    let mut candidates = [MatchCandidate::default(); LDM_BATCH_SIZE];

    if iend.checked_sub(istart).ok_or(BUG)? < min_match_length {
        return Ok(iend - anchor);
    }

    // Here and where it skips over a match, the C code calls `ZSTD_ldm_gear_reset`, which computes the hash of the
    // `min_match_length` bytes before `ip` and drops it: the rolling hash goes on from what it was.
    let mut hash_state = RollingHashState::new(params);
    ip += min_match_length;

    while ip < ilimit {
        let (hashed, num_splits) = hash_state.feed(buf.sub(ip..ilimit)?, &mut splits);

        for (candidate, &split) in candidates.iter_mut().zip(&splits).take(num_splits) {
            let split = ip + split - min_match_length;
            let xxhash = xxh64(buf.span(split, min_match_length)?);
            let hash = xxhash as u32 & bucket_mask;
            *candidate = MatchCandidate {
                split,
                hash,
                checksum: (xxhash >> 32) as u32,
                bucket: get_bucket(hash as usize, params.bucket_size_log),
            };
        }

        for candidate in candidates.iter().take(num_splits) {
            let MatchCandidate {
                split,
                hash,
                checksum,
                bucket,
            } = *candidate;
            let hash = hash as usize;
            let mut forward_match_length = 0usize;
            let mut backward_match_length = 0usize;
            let mut best_match_length = 0usize;
            let mut best_entry = None;
            let new_entry = LdmEntry {
                offset: prefix.index_of(split),
                checksum,
            };

            // A split inside the previous match is indexed, but not searched.
            if split < anchor {
                insert_entry(ldm_state, hash, new_entry, params.bucket_size_log)?;
                continue;
            }

            for cur in ldm_state.hash_table.span(bucket, ents_per_bucket)? {
                if cur.checksum != checksum || cur.offset <= lowest_index {
                    continue;
                }
                let (cur_forward_match_length, cur_backward_match_length) = if ext_dict
                    && cur.offset < dict_limit
                {
                    let p_match = dict_base.wrapping_add(cur.offset as usize);
                    let forward =
                        count_2segments(buf, split, dict_buf, p_match, iend, dict_end, low_prefix)?;
                    if forward < min_match_length {
                        continue;
                    }
                    let backward =
                        count_backwards_match(buf, split, anchor, dict_buf, p_match, dict_start)?;
                    (forward, backward)
                } else {
                    let p_match = prefix.pos_of(cur.offset);
                    let forward = count(buf, split, buf, p_match, iend)?;
                    if forward < min_match_length {
                        continue;
                    }
                    let backward = if ext_dict {
                        count_backwards_match_2segments(
                            buf, split, anchor, p_match, low_prefix, dict_buf, dict_start, dict_end,
                        )?
                    } else {
                        count_backwards_match(buf, split, anchor, buf, p_match, low_prefix)?
                    };
                    (forward, backward)
                };
                let cur_total_match_length = cur_forward_match_length + cur_backward_match_length;

                if cur_total_match_length > best_match_length {
                    best_match_length = cur_total_match_length;
                    forward_match_length = cur_forward_match_length;
                    backward_match_length = cur_backward_match_length;
                    best_entry = Some(*cur);
                }
            }

            let Some(best_entry) = best_entry else {
                insert_entry(ldm_state, hash, new_entry, params.bucket_size_log)?;
                continue;
            };

            let offset = new_entry.offset.wrapping_sub(best_entry.offset);
            let m_length = forward_match_length + backward_match_length;
            if raw_seq_store.size == raw_seq_store.capacity {
                return Err(ErrorCode::DstSizeTooSmall);
            }
            raw_seq_store.seq.put(
                raw_seq_store.size,
                RawSeq {
                    offset,
                    lit_length: (split - backward_match_length - anchor) as u32,
                    match_length: m_length as u32,
                },
            )?;
            raw_seq_store.size += 1;

            // Only now, so that the position does not match itself.
            insert_entry(ldm_state, hash, new_entry, params.bucket_size_log)?;

            anchor = split + forward_match_length;

            // The match goes beyond what was hashed: what is left of it is skipped, and the other candidates dropped.
            if anchor > ip + hashed {
                ip = anchor - hashed;
                break;
            }
        }

        ip += hashed;
    }

    Ok(iend - anchor)
}

/// `ZSTD_ldm_reduceTable`
fn reduce_table(table: &mut [LdmEntry], reducer_value: u32) {
    for entry in table {
        entry.offset = entry.offset.saturating_sub(reducer_value);
    }
}

/// `ZSTD_ldm_generateSequences`: adds to `sequences` the long distance matches of the input, which is the bytes from
/// `start` to `end` of the buffer of the current segment of the window, and which the window was updated with.
/// Stops early, without an error, at a chunk boundary where `sequences` is full.
pub(crate) fn generate_sequences(
    ldm_state: &mut LdmState,
    sequences: &mut RawSeqStore,
    params: &LdmParams,
    bufs: &Buffers<'_>,
    start: usize,
    end: usize,
) -> Result<()> {
    const K_MAX_CHUNK_SIZE: usize = 1 << 20;
    let max_dist = 1u32 << (params.window_log & 31);
    let buf_start = ldm_state.window.base_buf.start();
    let mut leftover_size = 0usize;
    let mut chunk_start = start;

    while chunk_start < end && sequences.size < sequences.capacity {
        let chunk_end = end.min(chunk_start + K_MAX_CHUNK_SIZE);
        let chunk_size = chunk_end - chunk_start;
        let prev_size = sequences.size;

        if ldm_state
            .window
            .need_overflow_correction(buf_start + chunk_end)
        {
            let ldm_h_size = 1usize << (params.hash_log & 31);
            let correction =
                ldm_state
                    .window
                    .correct_overflow(0, max_dist, buf_start + chunk_start);
            reduce_table(ldm_state.hash_table.sub_mut(..ldm_h_size)?, correction);
            // An overflow correction invalidates the dictionary.
            ldm_state.loaded_dict_end = 0;
        }
        // The whole chunk is searched with the window that its end has, so that no match is too far for any position
        // of it, at the cost of some matches at its start.
        if ldm_state.window.enforce_max_dist(
            buf_start + chunk_end,
            max_dist,
            ldm_state.loaded_dict_end,
        ) {
            ldm_state.loaded_dict_end = 0;
        }
        let new_leftover_size = generate_sequences_internal(
            ldm_state,
            sequences,
            params,
            bufs,
            chunk_start,
            chunk_end,
        )?;
        // What the previous chunks left goes to the literals of the first sequence of this one.
        if prev_size < sequences.size {
            let first = sequences.seq.at_mut(prev_size)?;
            first.lit_length = first.lit_length.wrapping_add(leftover_size as u32);
            leftover_size = new_leftover_size;
        } else {
            leftover_size += chunk_size;
        }
        chunk_start = chunk_end;
    }
    Ok(())
}

/// `ZSTD_ldm_skipSequences`: moves `src_size` bytes forward in the sequences. A match of which less than `min_match`
/// is left becomes literals of the next sequence.
pub(crate) fn skip_sequences(
    raw_seq_store: &mut RawSeqStore,
    mut src_size: usize,
    min_match: u32,
) -> Result<()> {
    while src_size > 0 && raw_seq_store.pos < raw_seq_store.size {
        let seq = raw_seq_store.seq.at_mut(raw_seq_store.pos)?;
        if src_size <= seq.lit_length as usize {
            seq.lit_length -= src_size as u32;
            return Ok(());
        }
        src_size -= seq.lit_length as usize;
        seq.lit_length = 0;
        if src_size < seq.match_length as usize {
            seq.match_length -= src_size as u32;
            if seq.match_length < min_match {
                let match_length = seq.match_length;
                if raw_seq_store.pos + 1 < raw_seq_store.size {
                    let next = raw_seq_store.seq.at_mut(raw_seq_store.pos + 1)?;
                    next.lit_length = next.lit_length.wrapping_add(match_length);
                }
                raw_seq_store.pos += 1;
            }
            return Ok(());
        }
        src_size -= seq.match_length as usize;
        seq.match_length = 0;
        raw_seq_store.pos += 1;
    }
    Ok(())
}

/// `maybeSplitSequence`: the next sequence, cut to the `remaining` bytes of the block. What is cut off stays in the
/// store. If there is no match of `min_match` left in the block, the offset is 0.
fn maybe_split_sequence(
    raw_seq_store: &mut RawSeqStore,
    remaining: u32,
    min_match: u32,
) -> Result<RawSeq> {
    let mut sequence = raw_seq_store.seq.at(raw_seq_store.pos)?;
    let length = sequence.lit_length.wrapping_add(sequence.match_length);
    if remaining >= length {
        raw_seq_store.pos += 1;
        return Ok(sequence);
    }
    if remaining <= sequence.lit_length {
        sequence.offset = 0;
    } else {
        sequence.match_length = remaining - sequence.lit_length;
        if sequence.match_length < min_match {
            sequence.offset = 0;
        }
    }
    skip_sequences(raw_seq_store, remaining as usize, min_match)?;
    Ok(sequence)
}

/// `ZSTD_ldm_skipRawSeqStoreBytes`: moves `nb_bytes` forward in the sequences, leaving them as they are.
pub(crate) fn skip_raw_seq_store_bytes(
    raw_seq_store: &mut RawSeqStore,
    nb_bytes: usize,
) -> Result<()> {
    let mut curr_pos = raw_seq_store.pos_in_sequence.wrapping_add(nb_bytes) as u32;
    while curr_pos != 0 && raw_seq_store.pos < raw_seq_store.size {
        let curr_seq = raw_seq_store.seq.at(raw_seq_store.pos)?;
        let length = curr_seq.lit_length.wrapping_add(curr_seq.match_length);
        if curr_pos >= length {
            curr_pos -= length;
            raw_seq_store.pos += 1;
        } else {
            raw_seq_store.pos_in_sequence = curr_pos as usize;
            break;
        }
    }
    if curr_pos == 0 || raw_seq_store.pos == raw_seq_store.size {
        raw_seq_store.pos_in_sequence = 0;
    }
    Ok(())
}

/// `ZSTD_ldm_blockCompress`: finds the sequences of the block `src`, given the long distance matches, which it moves
/// forward in by the size of the block. Returns how many bytes at the end of the block are in no sequence.
pub(crate) fn block_compress(
    raw_seq_store: &mut RawSeqStore,
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    use_row_match_finder: bool,
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let strategy = ms.c_params.strat();
    let min_match = ms.c_params.min_match;
    let dict_mode = ms.dict_mode(src.dms.as_ref());
    let iend = src.end;
    let mut ip = src.start;

    // The optimal parser weighs the long distance matches against its own.
    if strategy >= Strategy::BtOpt {
        let block = BlockSrc {
            ldm_seq_store: Some(&*raw_seq_store),
            ..*src
        };
        let last_ll_size = compress_block(
            ms,
            seq_store,
            rep,
            &block,
            strategy,
            use_row_match_finder,
            dict_mode,
        )?;
        skip_raw_seq_store_bytes(raw_seq_store, iend.wrapping_sub(ip))?;
        return Ok(last_ll_size);
    }

    while raw_seq_store.pos < raw_seq_store.size && ip < iend {
        let sequence = maybe_split_sequence(raw_seq_store, (iend - ip) as u32, min_match)?;
        if sequence.offset == 0 {
            break;
        }

        limit_table_update(ms, src, ip);
        fill_fast_tables(ms, src.prefix(), ip)?;
        // The block compressor takes care of the literals, and what it leaves goes with the long distance match.
        let literals = BlockSrc {
            start: ip,
            end: ip + sequence.lit_length as usize,
            ..*src
        };
        let new_lit_length = compress_block(
            ms,
            seq_store,
            rep,
            &literals,
            strategy,
            use_row_match_finder,
            dict_mode,
        )?;
        ip += sequence.lit_length as usize;
        let [rep0, rep1, _] = *rep;
        *rep = [sequence.offset, rep0, rep1];
        seq_store.store_seq(
            new_lit_length,
            src.buf,
            ip.checked_sub(new_lit_length).ok_or(BUG)?,
            offset_to_offbase(sequence.offset),
            sequence.match_length as usize,
        )?;
        ip += sequence.match_length as usize;
    }
    limit_table_update(ms, src, ip);
    fill_fast_tables(ms, src.prefix(), ip)?;
    let last = BlockSrc { start: ip, ..*src };
    compress_block(
        ms,
        seq_store,
        rep,
        &last,
        strategy,
        use_row_match_finder,
        dict_mode,
    )
}
