/* Drives the block compressors of zstd_fast.c and zstd_double_fast.c on match states made by hand. */
#define ZSTD_STATIC_LINKING_ONLY
#include "compress/zstd_compress_internal.h"
#include "compress/zstd_fast.h"
#include "compress/zstd_double_fast.h"
#include <stdlib.h>
#include <string.h>

typedef struct {
    ZSTD_MatchState_t ms;
    SeqStore_t seqStore;
} Shim;

typedef struct {
    U64 base, dictBase, nextSrc;
    U32 dictLimit, lowLimit, loadedDictEnd, nextToUpdate, dictMode, pad;
} ShimState;

Shim* shim_new(const U32* cp, size_t maxBlock)
{
    Shim* const s = (Shim*)calloc(1, sizeof(*s));
    ZSTD_window_init(&s->ms.window);
    s->ms.cParams.windowLog = cp[0];
    s->ms.cParams.chainLog = cp[1];
    s->ms.cParams.hashLog = cp[2];
    s->ms.cParams.searchLog = cp[3];
    s->ms.cParams.minMatch = cp[4];
    s->ms.cParams.targetLength = cp[5];
    s->ms.cParams.strategy = (ZSTD_strategy)cp[6];
    s->ms.hashTable = (U32*)calloc((size_t)1 << cp[2], sizeof(U32));
    s->ms.chainTable = (U32*)calloc((size_t)1 << cp[1], sizeof(U32));
    s->ms.nextToUpdate = s->ms.window.dictLimit;
    s->seqStore.maxNbSeq = maxBlock / 3 + 1;
    s->seqStore.maxNbLit = maxBlock;
    s->seqStore.sequencesStart = (SeqDef*)malloc(s->seqStore.maxNbSeq * sizeof(SeqDef));
    s->seqStore.litStart = (BYTE*)malloc(maxBlock + WILDCOPY_OVERLENGTH);
    ZSTD_resetSeqStore(&s->seqStore);
    return s;
}

void shim_free(Shim* s)
{
    free(s->ms.hashTable); free(s->ms.chainTable);
    free(s->seqStore.sequencesStart); free(s->seqStore.litStart);
    free(s);
}

void shim_state(const Shim* s, ShimState* st)
{
    st->base = (U64)(size_t)s->ms.window.base;
    st->dictBase = (U64)(size_t)s->ms.window.dictBase;
    st->nextSrc = (U64)(size_t)s->ms.window.nextSrc;
    st->dictLimit = s->ms.window.dictLimit;
    st->lowLimit = s->ms.window.lowLimit;
    st->loadedDictEnd = s->ms.loadedDictEnd;
    st->nextToUpdate = s->ms.nextToUpdate;
    st->dictMode = (U32)ZSTD_matchState_dictMode(&s->ms);
    st->pad = 0;
}

const U32* shim_hash_table(const Shim* s) { return s->ms.hashTable; }
const U32* shim_chain_table(const Shim* s) { return s->ms.chainTable; }

/* Indices go on from `index`, as after many frames. */
void shim_bump(Shim* s, U32 index)
{
    if (s->ms.window.dictLimit < index) {
        s->ms.window.nextSrc = s->ms.window.base + index;
        ZSTD_window_clear(&s->ms.window);
        s->ms.nextToUpdate = s->ms.window.dictLimit;
    }
}

/* ZSTD_loadDictionaryContent. Returns whether the tables were filled; `before` is the state right before that. */
int shim_load_dict(Shim* s, const void* src, size_t srcSize, int dtlm, int tfp, int forceNonContiguous, ShimState* before)
{
    ZSTD_MatchState_t* const ms = &s->ms;
    const BYTE* ip = (const BYTE*)src;
    const BYTE* const iend = ip + srcSize;
    {   U32 maxDictSize = ZSTD_CURRENT_MAX - ZSTD_WINDOW_START_INDEX;
        if (tfp == ZSTD_tfp_forCDict) {
            U32 const shortCacheMaxDictSize = (1u << (32 - ZSTD_SHORT_CACHE_TAG_BITS)) - ZSTD_WINDOW_START_INDEX;
            maxDictSize = MIN(maxDictSize, shortCacheMaxDictSize);
        }
        if (srcSize > maxDictSize) { ip = iend - maxDictSize; src = ip; srcSize = maxDictSize; }
    }
    ZSTD_window_update(&ms->window, src, srcSize, 0);
    {   U32 maxDictSize = 1U << MIN(MAX(ms->cParams.hashLog + 3, ms->cParams.chainLog + 1), 31);
        if (srcSize > maxDictSize) { ip = iend - maxDictSize; src = ip; srcSize = maxDictSize; }
    }
    ms->nextToUpdate = (U32)(ip - ms->window.base);
    ms->loadedDictEnd = (U32)(iend - ms->window.base);
    ms->forceNonContiguous = forceNonContiguous;
    shim_state(s, before);
    if (srcSize <= HASH_READ_SIZE) return 0;
    if (ms->cParams.strategy == ZSTD_fast)
        ZSTD_fillHashTable(ms, iend, (ZSTD_dictTableLoadMethod_e)dtlm, (ZSTD_tableFillPurpose_e)tfp);
    else
        ZSTD_fillDoubleHashTable(ms, iend, (ZSTD_dictTableLoadMethod_e)dtlm, (ZSTD_tableFillPurpose_e)tfp);
    ms->nextToUpdate = (U32)(iend - ms->window.base);
    return 1;
}

/* The end of ZSTD_resetCCtx_byAttachingCDict. Returns whether the dictionary is attached. */
int shim_attach(Shim* s, const Shim* dict)
{
    U32 const cdictEnd = (U32)(dict->ms.window.nextSrc - dict->ms.window.base);
    U32 const cdictLen = cdictEnd - dict->ms.window.dictLimit;
    if (cdictLen == 0) return 0;
    s->ms.dictMatchState = &dict->ms;
    if (s->ms.window.dictLimit < cdictEnd) {
        s->ms.window.nextSrc = s->ms.window.base + cdictEnd;
        ZSTD_window_clear(&s->ms.window);
    }
    s->ms.loadedDictEnd = s->ms.window.dictLimit;
    return 1;
}

/* The start of ZSTD_compressContinue_internal. Returns whether the input is contiguous. */
int shim_update(Shim* s, const void* src, size_t srcSize)
{
    ZSTD_MatchState_t* const ms = &s->ms;
    if (!ZSTD_window_update(&ms->window, src, srcSize, ms->forceNonContiguous)) {
        ms->forceNonContiguous = 0;
        ms->nextToUpdate = ms->window.dictLimit;
        return 0;
    }
    return 1;
}

/* What ZSTD_compress_frameChunk does before each block. */
void shim_pre_block(Shim* s, const void* src, size_t blockSize)
{
    ZSTD_MatchState_t* const ms = &s->ms;
    const BYTE* const ip = (const BYTE*)src;
    U32 const maxDist = (U32)1 << ms->cParams.windowLog;
    ZSTD_checkDictValidity(&ms->window, ip + blockSize, maxDist, &ms->loadedDictEnd, &ms->dictMatchState);
    ZSTD_window_enforceMaxDist(&ms->window, ip, maxDist, &ms->loadedDictEnd, &ms->dictMatchState);
    if (ms->nextToUpdate < ms->window.lowLimit) ms->nextToUpdate = ms->window.lowLimit;
}

size_t shim_block(Shim* s, U32* rep, const void* src, size_t srcSize)
{
    ZSTD_MatchState_t* const ms = &s->ms;
    ZSTD_dictMode_e const mode = ZSTD_matchState_dictMode(ms);
    ZSTD_resetSeqStore(&s->seqStore);
    if (ms->cParams.strategy == ZSTD_fast) {
        switch (mode) {
        case ZSTD_noDict: return ZSTD_compressBlock_fast(ms, &s->seqStore, rep, src, srcSize);
        case ZSTD_extDict: return ZSTD_compressBlock_fast_extDict(ms, &s->seqStore, rep, src, srcSize);
        default: return ZSTD_compressBlock_fast_dictMatchState(ms, &s->seqStore, rep, src, srcSize);
        }
    }
    switch (mode) {
    case ZSTD_noDict: return ZSTD_compressBlock_doubleFast(ms, &s->seqStore, rep, src, srcSize);
    case ZSTD_extDict: return ZSTD_compressBlock_doubleFast_extDict(ms, &s->seqStore, rep, src, srcSize);
    default: return ZSTD_compressBlock_doubleFast_dictMatchState(ms, &s->seqStore, rep, src, srcSize);
    }
}

size_t shim_nb_seq(const Shim* s) { return (size_t)(s->seqStore.sequences - s->seqStore.sequencesStart); }
const SeqDef* shim_seqs(const Shim* s) { return s->seqStore.sequencesStart; }
size_t shim_lit_len(const Shim* s) { return (size_t)(s->seqStore.lit - s->seqStore.litStart); }
const BYTE* shim_lits(const Shim* s) { return s->seqStore.litStart; }
U32 shim_long_type(const Shim* s) { return (U32)s->seqStore.longLengthType; }
U32 shim_long_pos(const Shim* s) { return s->seqStore.longLengthPos; }

/* From the harness of the lazy strategies: the state of a whole CCtx. */
#include "shim_cctx.inc"
