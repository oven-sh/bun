//! The parameters of `zstd_compress.c`: what can be asked for, and how it turns into what is applied.

use core::ops::RangeInclusive;

use super::internal::{
    CompressionParameters, LdmParams, ParamSwitch, Strategy, ZSTD_OPT_SIZE,
    ZSTD_SHORT_CACHE_TAG_BITS,
};
use super::lazy::ZSTD_ROW_HASH_TAG_BITS;
use super::{ldm, row_match_finder_supported};
use crate::common::{
    LITBITS, MAX_LL, MAX_ML, MAX_OFF, WILDCOPY_OVERLENGTH, ZSTD_BLOCKSIZE_MAX,
    ZSTD_CONTENTSIZE_UNKNOWN, ZSTD_WINDOWLOG_ABSOLUTEMIN, ZSTD_WINDOWLOG_LIMIT_DEFAULT,
    ZSTD_WINDOWLOG_MAX, ZSTD_WORKSPACETOOLARGE_FACTOR, ZSTD_WORKSPACETOOLARGE_MAXDURATION,
};
use crate::error::{ErrorCode, Result};
use crate::util::highbit32;

pub const ZSTD_CLEVEL_DEFAULT: i32 = 3;
const ZSTD_MAX_CLEVEL: i32 = 22;
const ZSTD_MIN_CLEVEL: i32 = -(ZSTD_TARGETLENGTH_MAX);

const ZSTD_WINDOWLOG_MIN: i32 = 10;
pub(crate) const ZSTD_HASHLOG_MAX: i32 = 30;
pub(crate) const ZSTD_HASHLOG_MIN: i32 = 6;
const ZSTD_CHAINLOG_MAX: i32 = 30;
const ZSTD_CHAINLOG_MIN: i32 = ZSTD_HASHLOG_MIN;
const ZSTD_SEARCHLOG_MAX: i32 = ZSTD_WINDOWLOG_MAX as i32 - 1;
const ZSTD_SEARCHLOG_MIN: i32 = 1;
const ZSTD_MINMATCH_MAX: i32 = 7;
const ZSTD_MINMATCH_MIN: i32 = 3;
const ZSTD_TARGETLENGTH_MAX: i32 = ZSTD_BLOCKSIZE_MAX as i32;
const ZSTD_TARGETLENGTH_MIN: i32 = 0;
const ZSTD_OVERLAPLOG_MIN: i32 = 0;
const ZSTD_OVERLAPLOG_MAX: i32 = 9;
const ZSTD_LDM_HASHLOG_MIN: i32 = ZSTD_HASHLOG_MIN;
const ZSTD_LDM_HASHLOG_MAX: i32 = ZSTD_HASHLOG_MAX;
const ZSTD_LDM_MINMATCH_MIN: i32 = 4;
const ZSTD_LDM_MINMATCH_MAX: i32 = 4096;
const ZSTD_LDM_BUCKETSIZELOG_MIN: i32 = 1;
pub(crate) const ZSTD_LDM_BUCKETSIZELOG_MAX: i32 = 8;
const ZSTD_LDM_HASHRATELOG_MIN: i32 = 0;
const ZSTD_LDM_HASHRATELOG_MAX: i32 = ZSTD_WINDOWLOG_MAX as i32 - ZSTD_HASHLOG_MIN;
const ZSTD_TARGETCBLOCKSIZE_MIN: i32 = 1340;
const ZSTD_TARGETCBLOCKSIZE_MAX: i32 = ZSTD_BLOCKSIZE_MAX as i32;
const ZSTD_LDM_DEFAULT_WINDOW_LOG: u32 = ZSTD_WINDOWLOG_LIMIT_DEFAULT;
pub(crate) const ZSTD_HASHLOG3_MAX: u32 = 17;

pub(crate) const ZSTDMT_NBWORKERS_MAX: i32 = 256;
pub(crate) const ZSTDMT_JOBSIZE_MIN: i32 = 512 << 10;
pub(crate) const ZSTDMT_JOBLOG_MAX: u32 = 30;
pub(crate) const ZSTDMT_JOBSIZE_MAX: i32 = 1024 << 20;

/// `ZSTD_cParameter`, as far as `node:zlib` lets a parameter through.
pub mod c_param {
    pub(crate) const FORMAT: i32 = 10;
    pub const COMPRESSION_LEVEL: i32 = 100;
    pub const WINDOW_LOG: i32 = 101;
    pub const HASH_LOG: i32 = 102;
    pub const CHAIN_LOG: i32 = 103;
    pub const SEARCH_LOG: i32 = 104;
    pub const MIN_MATCH: i32 = 105;
    pub const TARGET_LENGTH: i32 = 106;
    pub const STRATEGY: i32 = 107;
    pub(crate) const TARGET_C_BLOCK_SIZE: i32 = 130;
    pub const ENABLE_LONG_DISTANCE_MATCHING: i32 = 160;
    pub const LDM_HASH_LOG: i32 = 161;
    pub const LDM_MIN_MATCH: i32 = 162;
    pub const LDM_BUCKET_SIZE_LOG: i32 = 163;
    pub const LDM_HASH_RATE_LOG: i32 = 164;
    pub const CONTENT_SIZE_FLAG: i32 = 200;
    pub const CHECKSUM_FLAG: i32 = 201;
    pub const DICT_ID_FLAG: i32 = 202;
    pub const NB_WORKERS: i32 = 400;
    pub const JOB_SIZE: i32 = 401;
    pub const OVERLAP_LOG: i32 = 402;
}

/// `ZSTD_format_e`
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Format {
    Zstd1,
    Zstd1Magicless,
}

/// `ZSTD_frameParameters`
#[derive(Clone, Copy)]
pub(crate) struct FrameParameters {
    pub(crate) content_size_flag: bool,
    pub(crate) checksum_flag: bool,
    pub(crate) no_dict_id_flag: bool,
}

/// `ZSTD_parameters`
#[derive(Clone, Copy)]
pub(crate) struct Parameters {
    pub(crate) c_params: CompressionParameters,
    pub(crate) f_params: FrameParameters,
}

/// `ZSTD_CParamMode_e`: what the parameters are selected for.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CParamMode {
    /// No dictionary, or one that is copied or loaded into the context's own tables.
    NoAttachDict,
    /// The dictionary keeps its own tables, so its size does not count.
    AttachDict,
    CreateCDict,
}

/// `ZSTD_CCtx_params`, without the fields that nothing can change from their default.
#[derive(Clone, Copy)]
pub(crate) struct CCtxParams {
    pub(crate) format: Format,
    pub(crate) c_params: CompressionParameters,
    pub(crate) f_params: FrameParameters,
    pub(crate) compression_level: i32,
    /// Only the jobs of a multithreaded compression set it.
    pub(crate) force_window: bool,
    pub(crate) target_c_block_size: usize,
    pub(crate) nb_workers: i32,
    pub(crate) job_size: usize,
    pub(crate) overlap_log: i32,
    pub(crate) ldm_params: LdmParams,
    pub(crate) post_block_splitter: ParamSwitch,
    pub(crate) use_row_match_finder: ParamSwitch,
}

const NO_C_PARAMS: CompressionParameters = CompressionParameters {
    window_log: 0,
    chain_log: 0,
    hash_log: 0,
    search_log: 0,
    min_match: 0,
    target_length: 0,
    strategy: None,
};

pub(crate) const NO_LDM_PARAMS: LdmParams = LdmParams {
    enable_ldm: ParamSwitch::Auto,
    hash_log: 0,
    bucket_size_log: 0,
    min_match_length: 0,
    hash_rate_log: 0,
    window_log: 0,
};

/// `ZSTD_cParam_getBounds`
fn bounds(param: i32) -> Result<RangeInclusive<i32>> {
    Ok(match param {
        c_param::COMPRESSION_LEVEL => ZSTD_MIN_CLEVEL..=ZSTD_MAX_CLEVEL,
        c_param::WINDOW_LOG => ZSTD_WINDOWLOG_MIN..=ZSTD_WINDOWLOG_MAX as i32,
        c_param::HASH_LOG => ZSTD_HASHLOG_MIN..=ZSTD_HASHLOG_MAX,
        c_param::CHAIN_LOG => ZSTD_CHAINLOG_MIN..=ZSTD_CHAINLOG_MAX,
        c_param::SEARCH_LOG => ZSTD_SEARCHLOG_MIN..=ZSTD_SEARCHLOG_MAX,
        c_param::MIN_MATCH => ZSTD_MINMATCH_MIN..=ZSTD_MINMATCH_MAX,
        c_param::TARGET_LENGTH => ZSTD_TARGETLENGTH_MIN..=ZSTD_TARGETLENGTH_MAX,
        c_param::STRATEGY => Strategy::Fast as i32..=Strategy::BtUltra2 as i32,
        c_param::CONTENT_SIZE_FLAG | c_param::CHECKSUM_FLAG | c_param::DICT_ID_FLAG => 0..=1,
        c_param::NB_WORKERS => 0..=ZSTDMT_NBWORKERS_MAX,
        c_param::JOB_SIZE => 0..=ZSTDMT_JOBSIZE_MAX,
        c_param::OVERLAP_LOG => ZSTD_OVERLAPLOG_MIN..=ZSTD_OVERLAPLOG_MAX,
        c_param::ENABLE_LONG_DISTANCE_MATCHING => {
            ParamSwitch::Auto as i32..=ParamSwitch::Disable as i32
        }
        c_param::LDM_HASH_LOG => ZSTD_LDM_HASHLOG_MIN..=ZSTD_LDM_HASHLOG_MAX,
        c_param::LDM_MIN_MATCH => ZSTD_LDM_MINMATCH_MIN..=ZSTD_LDM_MINMATCH_MAX,
        c_param::LDM_BUCKET_SIZE_LOG => ZSTD_LDM_BUCKETSIZELOG_MIN..=ZSTD_LDM_BUCKETSIZELOG_MAX,
        c_param::LDM_HASH_RATE_LOG => ZSTD_LDM_HASHRATELOG_MIN..=ZSTD_LDM_HASHRATELOG_MAX,
        c_param::FORMAT => 0..=1,
        c_param::TARGET_C_BLOCK_SIZE => ZSTD_TARGETCBLOCKSIZE_MIN..=ZSTD_TARGETCBLOCKSIZE_MAX,
        _ => return Err(ErrorCode::ParameterUnsupported),
    })
}

/// `ZSTD_cParam_clampBounds`
fn clamp_bounds(param: i32, value: i32) -> Result<i32> {
    let bounds = bounds(param)?;
    Ok(value.clamp(*bounds.start(), *bounds.end()))
}

/// `BOUNDCHECK`
fn bound_check(param: i32, value: i32) -> Result<()> {
    if !bounds(param)?.contains(&value) {
        return Err(ErrorCode::ParameterOutOfBound);
    }
    Ok(())
}

/// `BOUNDCHECK`, for the parameters of which 0 means "use the default".
fn bound_check_unless_0(param: i32, value: i32) -> Result<u32> {
    if value != 0 {
        bound_check(param, value)?;
    }
    Ok(value as u32)
}

impl CCtxParams {
    /// `ZSTD_CCtxParams_init`
    pub(crate) const fn new(compression_level: i32) -> Self {
        Self {
            format: Format::Zstd1,
            c_params: NO_C_PARAMS,
            f_params: FrameParameters {
                content_size_flag: true,
                checksum_flag: false,
                no_dict_id_flag: false,
            },
            compression_level,
            force_window: false,
            target_c_block_size: 0,
            nb_workers: 0,
            job_size: 0,
            overlap_log: 0,
            ldm_params: NO_LDM_PARAMS,
            post_block_splitter: ParamSwitch::Auto,
            use_row_match_finder: ParamSwitch::Auto,
        }
    }

    /// `ZSTD_CCtxParams_init_internal`
    pub(crate) fn from_params(params: &Parameters, compression_level: i32) -> Self {
        let mut this = Self::new(compression_level);
        this.c_params = params.c_params;
        this.f_params = params.f_params;
        this.use_row_match_finder =
            resolve_row_match_finder_mode(this.use_row_match_finder, &params.c_params);
        this.post_block_splitter =
            resolve_block_splitter_mode(this.post_block_splitter, &params.c_params);
        this.ldm_params.enable_ldm =
            resolve_enable_ldm(this.ldm_params.enable_ldm, &params.c_params);
        this
    }

    /// `ZSTD_CCtxParams_setParameter`
    pub(crate) fn set_parameter(&mut self, param: i32, value: i32) -> Result<usize> {
        match param {
            c_param::FORMAT => {
                bound_check(param, value)?;
                self.format = if value == 0 {
                    Format::Zstd1
                } else {
                    Format::Zstd1Magicless
                };
                Ok(value as usize)
            }
            c_param::COMPRESSION_LEVEL => {
                let value = clamp_bounds(param, value)?;
                self.compression_level = if value == 0 {
                    ZSTD_CLEVEL_DEFAULT
                } else {
                    value
                };
                Ok(self.compression_level.max(0) as usize)
            }
            c_param::WINDOW_LOG => {
                self.c_params.window_log = bound_check_unless_0(param, value)?;
                Ok(value as usize)
            }
            c_param::HASH_LOG => {
                self.c_params.hash_log = bound_check_unless_0(param, value)?;
                Ok(value as usize)
            }
            c_param::CHAIN_LOG => {
                self.c_params.chain_log = bound_check_unless_0(param, value)?;
                Ok(value as usize)
            }
            c_param::SEARCH_LOG => {
                self.c_params.search_log = bound_check_unless_0(param, value)?;
                Ok(value as usize)
            }
            c_param::MIN_MATCH => {
                self.c_params.min_match = bound_check_unless_0(param, value)?;
                Ok(value as usize)
            }
            c_param::TARGET_LENGTH => {
                bound_check(param, value)?;
                self.c_params.target_length = value as u32;
                Ok(value as usize)
            }
            c_param::STRATEGY => {
                bound_check_unless_0(param, value)?;
                self.c_params.strategy = Strategy::from_int(value);
                Ok(value as usize)
            }
            c_param::CONTENT_SIZE_FLAG => {
                self.f_params.content_size_flag = value != 0;
                Ok(usize::from(value != 0))
            }
            c_param::CHECKSUM_FLAG => {
                self.f_params.checksum_flag = value != 0;
                Ok(usize::from(value != 0))
            }
            c_param::DICT_ID_FLAG => {
                self.f_params.no_dict_id_flag = value == 0;
                Ok(usize::from(value != 0))
            }
            c_param::NB_WORKERS => {
                self.nb_workers = clamp_bounds(param, value)?;
                Ok(self.nb_workers as usize)
            }
            c_param::JOB_SIZE => {
                let value = if value != 0 && value < ZSTDMT_JOBSIZE_MIN {
                    ZSTDMT_JOBSIZE_MIN
                } else {
                    value
                };
                self.job_size = clamp_bounds(param, value)? as usize;
                Ok(self.job_size)
            }
            c_param::OVERLAP_LOG => {
                self.overlap_log = clamp_bounds(param, value)?;
                Ok(self.overlap_log as usize)
            }
            c_param::ENABLE_LONG_DISTANCE_MATCHING => {
                bound_check(param, value)?;
                self.ldm_params.enable_ldm = match value {
                    0 => ParamSwitch::Auto,
                    1 => ParamSwitch::Enable,
                    _ => ParamSwitch::Disable,
                };
                Ok(value as usize)
            }
            c_param::LDM_HASH_LOG => {
                self.ldm_params.hash_log = bound_check_unless_0(param, value)?;
                Ok(value as usize)
            }
            c_param::LDM_MIN_MATCH => {
                self.ldm_params.min_match_length = bound_check_unless_0(param, value)?;
                Ok(value as usize)
            }
            c_param::LDM_BUCKET_SIZE_LOG => {
                self.ldm_params.bucket_size_log = bound_check_unless_0(param, value)?;
                Ok(value as usize)
            }
            c_param::LDM_HASH_RATE_LOG => {
                self.ldm_params.hash_rate_log = bound_check_unless_0(param, value)?;
                Ok(value as usize)
            }
            c_param::TARGET_C_BLOCK_SIZE => {
                let value = if value != 0 {
                    value.max(ZSTD_TARGETCBLOCKSIZE_MIN)
                } else {
                    value
                };
                self.target_c_block_size = bound_check_unless_0(param, value)? as usize;
                Ok(self.target_c_block_size)
            }
            _ => Err(ErrorCode::ParameterUnsupported),
        }
    }
}

/// `ZSTD_rowMatchFinderUsed`
pub(crate) fn row_match_finder_used(strategy: Strategy, mode: ParamSwitch) -> bool {
    row_match_finder_supported(strategy) && mode == ParamSwitch::Enable
}

/// `ZSTD_resolveRowMatchFinderMode`
pub(crate) fn resolve_row_match_finder_mode(
    mode: ParamSwitch,
    c_params: &CompressionParameters,
) -> ParamSwitch {
    if mode != ParamSwitch::Auto {
        return mode;
    }
    if row_match_finder_supported(c_params.strat()) && c_params.window_log > 14 {
        ParamSwitch::Enable
    } else {
        ParamSwitch::Disable
    }
}

/// `ZSTD_resolveBlockSplitterMode`
pub(crate) fn resolve_block_splitter_mode(
    mode: ParamSwitch,
    c_params: &CompressionParameters,
) -> ParamSwitch {
    if mode != ParamSwitch::Auto {
        return mode;
    }
    if c_params.strat() >= Strategy::BtOpt && c_params.window_log >= 17 {
        ParamSwitch::Enable
    } else {
        ParamSwitch::Disable
    }
}

/// `ZSTD_allocateChainTable`
pub(crate) fn allocate_chain_table(strategy: Strategy, use_row_match_finder: ParamSwitch) -> bool {
    strategy != Strategy::Fast && !row_match_finder_used(strategy, use_row_match_finder)
}

/// `ZSTD_resolveEnableLdm`
pub(crate) fn resolve_enable_ldm(
    mode: ParamSwitch,
    c_params: &CompressionParameters,
) -> ParamSwitch {
    if mode != ParamSwitch::Auto {
        return mode;
    }
    if c_params.strat() >= Strategy::BtOpt && c_params.window_log >= 27 {
        ParamSwitch::Enable
    } else {
        ParamSwitch::Disable
    }
}

/// `ZSTD_CDictIndicesAreTagged`
pub(crate) fn cdict_indices_are_tagged(c_params: &CompressionParameters) -> bool {
    matches!(c_params.strat(), Strategy::Fast | Strategy::DFast)
}

/// `ZSTD_cycleLog`
pub(crate) fn cycle_log(hash_log: u32, strat: Strategy) -> u32 {
    hash_log - u32::from(strat >= Strategy::BtLazy2)
}

/// `ZSTD_dictAndWindowLog`: the log of a window that also covers the dictionary.
fn dict_and_window_log(window_log: u32, src_size: u64, dict_size: u64) -> u32 {
    let max_window_size = 1u64 << ZSTD_WINDOWLOG_MAX;
    if dict_size == 0 {
        return window_log;
    }
    let window_size = 1u64 << window_log;
    let dict_and_window_size = dict_size + window_size;
    if window_size >= dict_size.wrapping_add(src_size) {
        window_log
    } else if dict_and_window_size >= max_window_size {
        ZSTD_WINDOWLOG_MAX
    } else {
        highbit32(dict_and_window_size as u32 - 1) + 1
    }
}

/// `ZSTD_adjustCParams_internal`
pub(crate) fn adjust_c_params_internal(
    mut c_par: CompressionParameters,
    mut src_size: u64,
    mut dict_size: usize,
    mode: CParamMode,
    mut use_row_match_finder: ParamSwitch,
) -> CompressionParameters {
    const MIN_SRC_SIZE: u64 = 513;
    const MAX_WINDOW_RESIZE: u64 = 1 << (ZSTD_WINDOWLOG_MAX - 1);

    match mode {
        CParamMode::NoAttachDict => {}
        CParamMode::CreateCDict => {
            if dict_size != 0 && src_size == ZSTD_CONTENTSIZE_UNKNOWN {
                src_size = MIN_SRC_SIZE;
            }
        }
        CParamMode::AttachDict => dict_size = 0,
    }

    if src_size <= MAX_WINDOW_RESIZE && dict_size as u64 <= MAX_WINDOW_RESIZE {
        let t_size = (src_size + dict_size as u64) as u32;
        const HASH_SIZE_MIN: u32 = 1 << ZSTD_HASHLOG_MIN;
        let src_log = if t_size < HASH_SIZE_MIN {
            ZSTD_HASHLOG_MIN as u32
        } else {
            highbit32(t_size - 1) + 1
        };
        c_par.window_log = c_par.window_log.min(src_log);
    }
    if src_size != ZSTD_CONTENTSIZE_UNKNOWN {
        let dict_and_window_log = dict_and_window_log(c_par.window_log, src_size, dict_size as u64);
        let cycle_log = cycle_log(c_par.chain_log, c_par.strat());
        c_par.hash_log = c_par.hash_log.min(dict_and_window_log + 1);
        if cycle_log > dict_and_window_log {
            c_par.chain_log -= cycle_log - dict_and_window_log;
        }
    }

    c_par.window_log = c_par.window_log.max(ZSTD_WINDOWLOG_ABSOLUTEMIN);

    if mode == CParamMode::CreateCDict && cdict_indices_are_tagged(&c_par) {
        let max_short_cache_hash_log = 32 - ZSTD_SHORT_CACHE_TAG_BITS;
        c_par.hash_log = c_par.hash_log.min(max_short_cache_hash_log);
        c_par.chain_log = c_par.chain_log.min(max_short_cache_hash_log);
    }

    if use_row_match_finder == ParamSwitch::Auto {
        use_row_match_finder = ParamSwitch::Enable;
    }
    if row_match_finder_used(c_par.strat(), use_row_match_finder) {
        // The rows' hashes are 32 bits, some of which are the tag.
        let row_log = c_par.search_log.clamp(4, 6);
        let max_row_hash_log = 32 - ZSTD_ROW_HASH_TAG_BITS;
        c_par.hash_log = c_par.hash_log.min(max_row_hash_log + row_log);
    }

    c_par
}

/// `ZSTD_overrideCParams`
fn override_c_params(c_params: &mut CompressionParameters, overrides: &CompressionParameters) {
    if overrides.window_log != 0 {
        c_params.window_log = overrides.window_log;
    }
    if overrides.hash_log != 0 {
        c_params.hash_log = overrides.hash_log;
    }
    if overrides.chain_log != 0 {
        c_params.chain_log = overrides.chain_log;
    }
    if overrides.search_log != 0 {
        c_params.search_log = overrides.search_log;
    }
    if overrides.min_match != 0 {
        c_params.min_match = overrides.min_match;
    }
    if overrides.target_length != 0 {
        c_params.target_length = overrides.target_length;
    }
    if overrides.strategy.is_some() {
        c_params.strategy = overrides.strategy;
    }
}

/// `ZSTD_getCParamsFromCCtxParams`
pub(crate) fn get_c_params_from_cctx_params(
    cctx_params: &CCtxParams,
    src_size_hint: u64,
    dict_size: usize,
    mode: CParamMode,
) -> CompressionParameters {
    let mut c_params = get_c_params_internal(
        cctx_params.compression_level,
        src_size_hint,
        dict_size,
        mode,
    );
    if cctx_params.ldm_params.enable_ldm == ParamSwitch::Enable {
        c_params.window_log = ZSTD_LDM_DEFAULT_WINDOW_LOG;
    }
    override_c_params(&mut c_params, &cctx_params.c_params);
    adjust_c_params_internal(
        c_params,
        src_size_hint,
        dict_size,
        mode,
        cctx_params.use_row_match_finder,
    )
}

/// `ZSTD_getCParamRowSize`: the size that selects a table of [`DEFAULT_C_PARAMETERS`].
fn get_c_param_row_size(src_size_hint: u64, mut dict_size: usize, mode: CParamMode) -> u64 {
    if mode == CParamMode::AttachDict {
        dict_size = 0;
    }
    let unknown = src_size_hint == ZSTD_CONTENTSIZE_UNKNOWN;
    let added_size: u64 = if unknown && dict_size > 0 { 500 } else { 0 };
    if unknown && dict_size == 0 {
        ZSTD_CONTENTSIZE_UNKNOWN
    } else {
        src_size_hint
            .wrapping_add(dict_size as u64)
            .wrapping_add(added_size)
    }
}

/// `ZSTD_getCParams_internal`
pub(crate) fn get_c_params_internal(
    compression_level: i32,
    src_size_hint: u64,
    dict_size: usize,
    mode: CParamMode,
) -> CompressionParameters {
    let r_size = get_c_param_row_size(src_size_hint, dict_size, mode);
    let table_id = usize::from(r_size <= 256 << 10)
        + usize::from(r_size <= 128 << 10)
        + usize::from(r_size <= 16 << 10);
    let row = match compression_level {
        0 => ZSTD_CLEVEL_DEFAULT,
        ..0 => 0,
        _ => compression_level.min(ZSTD_MAX_CLEVEL),
    };
    let mut cp = DEFAULT_C_PARAMETERS
        .get(table_id)
        .and_then(|table| table.get(row as usize))
        .copied()
        .unwrap_or(NO_C_PARAMS);
    if compression_level < 0 {
        // Negative levels go faster by skipping more.
        cp.target_length = compression_level.max(ZSTD_MIN_CLEVEL).unsigned_abs();
    }
    adjust_c_params_internal(cp, src_size_hint, dict_size, mode, ParamSwitch::Auto)
}

/// `ZSTD_getParams_internal`
pub(crate) fn get_params_internal(
    compression_level: i32,
    src_size_hint: u64,
    dict_size: usize,
    mode: CParamMode,
) -> Parameters {
    Parameters {
        c_params: get_c_params_internal(compression_level, src_size_hint, dict_size, mode),
        f_params: FrameParameters {
            content_size_flag: true,
            checksum_flag: false,
            no_dict_id_flag: false,
        },
    }
}

/// `ZSTD_compressBound`: the most that `src_size` bytes can take once compressed. No slice is of a size that is too
/// large for it, which gives more than can be allocated, as the error code of the C function is.
pub const fn compress_bound(src_size: usize) -> usize {
    const ZSTD_MAX_INPUT_SIZE: usize = 0xFF00_FF00_FF00_FF00;
    if src_size >= ZSTD_MAX_INPUT_SIZE {
        return usize::MAX;
    }
    // A margin for small inputs, so that the bound of two inputs is at most that of both together.
    let margin = if src_size < (128 << 10) {
        ((128 << 10) - src_size) >> 11
    } else {
        0
    };
    src_size + (src_size >> 8) + margin
}

// ── the size of the workspace ────────────────────────────────────────────────
//
// The C code carves all the tables and buffers of a context out of one allocation. A context only goes on counting
// indexes from where the previous frame left them as long as that allocation is kept, so this keeps its books.

const SIZEOF_COMPRESSED_BLOCK_STATE: usize = 5632;
const TMP_WORKSPACE_SIZE: usize = 8920;
const SIZEOF_SEQ_DEF: usize = 8;
const SIZEOF_MATCH: usize = 8;
const SIZEOF_OPTIMAL: usize = 28;
const SIZEOF_RAW_SEQ: usize = 12;
const SIZEOF_LDM_ENTRY: usize = 8;
const ZSTD_CWKSP_ALIGNMENT_BYTES: usize = 64;

/// `ZSTD_cwksp_aligned64_alloc_size`
const fn aligned64(size: usize) -> usize {
    size.next_multiple_of(ZSTD_CWKSP_ALIGNMENT_BYTES)
}

/// `ZSTD_maxNbSeq`
pub(crate) const fn max_nb_seq(block_size: usize, min_match: u32) -> usize {
    block_size / if min_match == 3 { 3 } else { 4 }
}

/// The sizes of the tables of a context's match state.
pub(crate) struct MatchStateSizes {
    pub(crate) chain_size: usize,
    pub(crate) h_size: usize,
    pub(crate) hash_log3: u32,
    pub(crate) h3_size: usize,
}

impl MatchStateSizes {
    pub(crate) fn new(
        c_params: &CompressionParameters,
        use_row_match_finder: ParamSwitch,
        for_cctx: bool,
    ) -> Self {
        let hash_log3 = if for_cctx && c_params.min_match == 3 {
            ZSTD_HASHLOG3_MAX.min(c_params.window_log)
        } else {
            0
        };
        Self {
            chain_size: if allocate_chain_table(c_params.strat(), use_row_match_finder) {
                1 << c_params.chain_log
            } else {
                0
            },
            h_size: 1 << c_params.hash_log,
            hash_log3,
            h3_size: if hash_log3 != 0 { 1 << hash_log3 } else { 0 },
        }
    }
}

/// The books of a `ZSTD_cwksp`, as offsets from its start, which is taken to be aligned.
pub(crate) struct Workspace {
    size: usize,
    object_end: usize,
    table_end: usize,
    alloc_start: usize,
    oversized_duration: usize,
}

/// What a context needs room for.
pub(crate) struct WorkspaceNeeds<'a> {
    pub(crate) c_params: &'a CompressionParameters,
    pub(crate) ldm_params: &'a LdmParams,
    pub(crate) use_row_match_finder: ParamSwitch,
    pub(crate) buff_in_size: usize,
    pub(crate) buff_out_size: usize,
    pub(crate) block_size: usize,
}

impl WorkspaceNeeds<'_> {
    /// The tables, which the C code allocates from the bottom.
    fn tables(&self) -> usize {
        let sizes = MatchStateSizes::new(self.c_params, self.use_row_match_finder, true);
        (sizes.chain_size + sizes.h_size + sizes.h3_size) * size_of::<u32>()
    }

    /// Everything else, which the C code allocates from the top.
    fn allocs(&self) -> usize {
        let max_nb_seq = max_nb_seq(self.block_size, self.c_params.min_match);
        let mut total = 0;
        if row_match_finder_used(self.c_params.strat(), self.use_row_match_finder) {
            total += aligned64(1 << self.c_params.hash_log);
        }
        if self.c_params.strat() >= Strategy::BtOpt {
            total += aligned64((MAX_ML as usize + 1) * size_of::<u32>())
                + aligned64((MAX_LL as usize + 1) * size_of::<u32>())
                + aligned64((MAX_OFF as usize + 1) * size_of::<u32>())
                + aligned64((1 << LITBITS) * size_of::<u32>())
                + aligned64(ZSTD_OPT_SIZE * SIZEOF_MATCH)
                + aligned64(ZSTD_OPT_SIZE * SIZEOF_OPTIMAL);
        }
        total += aligned64(max_nb_seq * SIZEOF_SEQ_DEF);
        if self.ldm_params.enable_ldm == ParamSwitch::Enable {
            total += aligned64((1usize << self.ldm_params.hash_log) * SIZEOF_LDM_ENTRY)
                + aligned64(
                    ldm::get_max_nb_seq(*self.ldm_params, self.block_size) * SIZEOF_RAW_SEQ,
                )
                + (1usize << (self.ldm_params.hash_log - self.ldm_params.bucket_size_log));
        }
        total
            + (self.block_size + WILDCOPY_OVERLENGTH)
            + self.buff_in_size
            + self.buff_out_size
            + 3 * max_nb_seq
    }

    /// `ZSTD_estimateCCtxSize_usingCCtxParams_internal`
    fn needed_space(&self) -> usize {
        let objects = TMP_WORKSPACE_SIZE + 2 * SIZEOF_COMPRESSED_BLOCK_STATE;
        let slack_space = ZSTD_CWKSP_ALIGNMENT_BYTES * 2;
        objects + self.tables() + self.allocs() + slack_space
    }
}

impl Workspace {
    pub(crate) const fn new() -> Self {
        Self {
            size: 0,
            object_end: 0,
            table_end: 0,
            alloc_start: 0,
            oversized_duration: 0,
        }
    }

    /// What `ZSTD_resetCCtx_internal` does to the workspace. Returns whether it made a new one.
    pub(crate) fn reset(&mut self, needs: &WorkspaceNeeds<'_>) -> bool {
        let needed_space = needs.needed_space();
        self.oversized_duration += 1;
        let too_small = self.size < needed_space;
        let wasteful = self.alloc_start - self.table_end
            >= needed_space.saturating_mul(ZSTD_WORKSPACETOOLARGE_FACTOR)
            && self.oversized_duration > ZSTD_WORKSPACETOOLARGE_MAXDURATION;
        let resize = too_small || wasteful;
        if resize {
            self.size = needed_space;
            self.object_end = aligned64(TMP_WORKSPACE_SIZE + 2 * SIZEOF_COMPRESSED_BLOCK_STATE);
            self.oversized_duration = 0;
        }
        self.table_end = self.object_end + needs.tables();
        self.alloc_start =
            (self.size - self.size % ZSTD_CWKSP_ALIGNMENT_BYTES).saturating_sub(needs.allocs());
        self.alloc_start = self.alloc_start.max(self.table_end);
        resize
    }
}

const fn cp(
    window_log: u32,
    chain_log: u32,
    hash_log: u32,
    search_log: u32,
    min_match: u32,
    target_length: u32,
    strategy: Strategy,
) -> CompressionParameters {
    CompressionParameters {
        window_log,
        chain_log,
        hash_log,
        search_log,
        min_match,
        target_length,
        strategy: Some(strategy),
    }
}

/// `ZSTD_defaultCParameters`: for any size of input, then for at most 256 KB, 128 KB and 16 KB.
#[rustfmt::skip]
static DEFAULT_C_PARAMETERS: [[CompressionParameters; ZSTD_MAX_CLEVEL as usize + 1]; 4] = [
    [
        cp(19, 12, 13,  1, 6,   1, Strategy::Fast),
        cp(19, 13, 14,  1, 7,   0, Strategy::Fast),
        cp(20, 15, 16,  1, 6,   0, Strategy::Fast),
        cp(21, 16, 17,  1, 5,   0, Strategy::DFast),
        cp(21, 18, 18,  1, 5,   0, Strategy::DFast),
        cp(21, 18, 19,  3, 5,   2, Strategy::Greedy),
        cp(21, 18, 19,  3, 5,   4, Strategy::Lazy),
        cp(21, 19, 20,  4, 5,   8, Strategy::Lazy),
        cp(21, 19, 20,  4, 5,  16, Strategy::Lazy2),
        cp(22, 20, 21,  4, 5,  16, Strategy::Lazy2),
        cp(22, 21, 22,  5, 5,  16, Strategy::Lazy2),
        cp(22, 21, 22,  6, 5,  16, Strategy::Lazy2),
        cp(22, 22, 23,  6, 5,  32, Strategy::Lazy2),
        cp(22, 22, 22,  4, 5,  32, Strategy::BtLazy2),
        cp(22, 22, 23,  5, 5,  32, Strategy::BtLazy2),
        cp(22, 23, 23,  6, 5,  32, Strategy::BtLazy2),
        cp(22, 22, 22,  5, 5,  48, Strategy::BtOpt),
        cp(23, 23, 22,  5, 4,  64, Strategy::BtOpt),
        cp(23, 23, 22,  6, 3,  64, Strategy::BtUltra),
        cp(23, 24, 22,  7, 3, 256, Strategy::BtUltra2),
        cp(25, 25, 23,  7, 3, 256, Strategy::BtUltra2),
        cp(26, 26, 24,  7, 3, 512, Strategy::BtUltra2),
        cp(27, 27, 25,  9, 3, 999, Strategy::BtUltra2),
    ],
    [
        cp(18, 12, 13,  1, 5,   1, Strategy::Fast),
        cp(18, 13, 14,  1, 6,   0, Strategy::Fast),
        cp(18, 14, 14,  1, 5,   0, Strategy::DFast),
        cp(18, 16, 16,  1, 4,   0, Strategy::DFast),
        cp(18, 16, 17,  3, 5,   2, Strategy::Greedy),
        cp(18, 17, 18,  5, 5,   2, Strategy::Greedy),
        cp(18, 18, 19,  3, 5,   4, Strategy::Lazy),
        cp(18, 18, 19,  4, 4,   4, Strategy::Lazy),
        cp(18, 18, 19,  4, 4,   8, Strategy::Lazy2),
        cp(18, 18, 19,  5, 4,   8, Strategy::Lazy2),
        cp(18, 18, 19,  6, 4,   8, Strategy::Lazy2),
        cp(18, 18, 19,  5, 4,  12, Strategy::BtLazy2),
        cp(18, 19, 19,  7, 4,  12, Strategy::BtLazy2),
        cp(18, 18, 19,  4, 4,  16, Strategy::BtOpt),
        cp(18, 18, 19,  4, 3,  32, Strategy::BtOpt),
        cp(18, 18, 19,  6, 3, 128, Strategy::BtOpt),
        cp(18, 19, 19,  6, 3, 128, Strategy::BtUltra),
        cp(18, 19, 19,  8, 3, 256, Strategy::BtUltra),
        cp(18, 19, 19,  6, 3, 128, Strategy::BtUltra2),
        cp(18, 19, 19,  8, 3, 256, Strategy::BtUltra2),
        cp(18, 19, 19, 10, 3, 512, Strategy::BtUltra2),
        cp(18, 19, 19, 12, 3, 512, Strategy::BtUltra2),
        cp(18, 19, 19, 13, 3, 999, Strategy::BtUltra2),
    ],
    [
        cp(17, 12, 12,  1, 5,   1, Strategy::Fast),
        cp(17, 12, 13,  1, 6,   0, Strategy::Fast),
        cp(17, 13, 15,  1, 5,   0, Strategy::Fast),
        cp(17, 15, 16,  2, 5,   0, Strategy::DFast),
        cp(17, 17, 17,  2, 4,   0, Strategy::DFast),
        cp(17, 16, 17,  3, 4,   2, Strategy::Greedy),
        cp(17, 16, 17,  3, 4,   4, Strategy::Lazy),
        cp(17, 16, 17,  3, 4,   8, Strategy::Lazy2),
        cp(17, 16, 17,  4, 4,   8, Strategy::Lazy2),
        cp(17, 16, 17,  5, 4,   8, Strategy::Lazy2),
        cp(17, 16, 17,  6, 4,   8, Strategy::Lazy2),
        cp(17, 17, 17,  5, 4,   8, Strategy::BtLazy2),
        cp(17, 18, 17,  7, 4,  12, Strategy::BtLazy2),
        cp(17, 18, 17,  3, 4,  12, Strategy::BtOpt),
        cp(17, 18, 17,  4, 3,  32, Strategy::BtOpt),
        cp(17, 18, 17,  6, 3, 256, Strategy::BtOpt),
        cp(17, 18, 17,  6, 3, 128, Strategy::BtUltra),
        cp(17, 18, 17,  8, 3, 256, Strategy::BtUltra),
        cp(17, 18, 17, 10, 3, 512, Strategy::BtUltra),
        cp(17, 18, 17,  5, 3, 256, Strategy::BtUltra2),
        cp(17, 18, 17,  7, 3, 512, Strategy::BtUltra2),
        cp(17, 18, 17,  9, 3, 512, Strategy::BtUltra2),
        cp(17, 18, 17, 11, 3, 999, Strategy::BtUltra2),
    ],
    [
        cp(14, 12, 13,  1, 5,   1, Strategy::Fast),
        cp(14, 14, 15,  1, 5,   0, Strategy::Fast),
        cp(14, 14, 15,  1, 4,   0, Strategy::Fast),
        cp(14, 14, 15,  2, 4,   0, Strategy::DFast),
        cp(14, 14, 14,  4, 4,   2, Strategy::Greedy),
        cp(14, 14, 14,  3, 4,   4, Strategy::Lazy),
        cp(14, 14, 14,  4, 4,   8, Strategy::Lazy2),
        cp(14, 14, 14,  6, 4,   8, Strategy::Lazy2),
        cp(14, 14, 14,  8, 4,   8, Strategy::Lazy2),
        cp(14, 15, 14,  5, 4,   8, Strategy::BtLazy2),
        cp(14, 15, 14,  9, 4,   8, Strategy::BtLazy2),
        cp(14, 15, 14,  3, 4,  12, Strategy::BtOpt),
        cp(14, 15, 14,  4, 3,  24, Strategy::BtOpt),
        cp(14, 15, 14,  5, 3,  32, Strategy::BtUltra),
        cp(14, 15, 15,  6, 3,  64, Strategy::BtUltra),
        cp(14, 15, 15,  7, 3, 256, Strategy::BtUltra),
        cp(14, 15, 15,  5, 3,  48, Strategy::BtUltra2),
        cp(14, 15, 15,  6, 3, 128, Strategy::BtUltra2),
        cp(14, 15, 15,  7, 3, 256, Strategy::BtUltra2),
        cp(14, 15, 15,  8, 3, 256, Strategy::BtUltra2),
        cp(14, 15, 15,  8, 3, 512, Strategy::BtUltra2),
        cp(14, 15, 15,  9, 3, 512, Strategy::BtUltra2),
        cp(14, 15, 15, 10, 3, 999, Strategy::BtUltra2),
    ],
];
