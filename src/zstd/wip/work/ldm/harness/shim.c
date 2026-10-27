/* What the tests need of the internals of the C library. */
#include <stdlib.h>
#include <string.h>
#include "compress/zstd_ldm.h"

typedef struct {
    ldmState_t st;
    ldmParams_t p;
    BYTE* bufs[3];
    RawSeqStore_t store;
} shim_ldm;

shim_ldm* shim_ldm_new(const U32* p, const size_t* sizes, size_t capacity, U32 startIndex)
{
    shim_ldm* s = (shim_ldm*)calloc(1, sizeof(*s));
    int i;
    s->p.enableLdm = (ZSTD_ParamSwitch_e)p[0];
    s->p.hashLog = p[1]; s->p.bucketSizeLog = p[2]; s->p.minMatchLength = p[3]; s->p.hashRateLog = p[4]; s->p.windowLog = p[5];
    ZSTD_window_init(&s->st.window);
    s->st.hashTable = (ldmEntry_t*)calloc((size_t)1 << p[1], sizeof(ldmEntry_t));
    s->st.bucketOffsets = (BYTE*)calloc((size_t)1 << (p[1] - p[2]), 1);
    if (startIndex) {
        s->st.window.nextSrc = s->st.window.base + startIndex;
        ZSTD_window_clear(&s->st.window);
    }
    for (i = 0; i < 3; i++) s->bufs[i] = (BYTE*)calloc(sizes[i] + 64, 1);
    s->store.seq = (rawSeq*)calloc(capacity + 1, sizeof(rawSeq));
    s->store.capacity = capacity;
    return s;
}

void shim_ldm_free(shim_ldm* s)
{
    int i;
    for (i = 0; i < 3; i++) free(s->bufs[i]);
    free(s->st.hashTable); free(s->st.bucketOffsets); free(s->store.seq); free(s);
}

void shim_ldm_update(shim_ldm* s, int buf, size_t pos, const void* data, size_t len)
{
    memcpy(s->bufs[buf] + pos, data, len);
    ZSTD_window_update(&s->st.window, s->bufs[buf] + pos, len, 0);
}

void shim_ldm_poke(shim_ldm* s, int buf, size_t pos, BYTE byte) { s->bufs[buf][pos] = byte; }

void shim_ldm_load_dict(shim_ldm* s, int buf, size_t pos, const void* data, size_t len)
{
    const BYTE* ip = s->bufs[buf] + pos;
    shim_ldm_update(s, buf, pos, data, len);
    s->st.loadedDictEnd = (U32)(ip + len - s->st.window.base);
    ZSTD_ldm_fillHashTable(&s->st, ip, ip + len, &s->p);
}

size_t shim_ldm_generate(shim_ldm* s, int buf, size_t pos, size_t len, int reset)
{
    if (reset) { s->store.size = 0; s->store.pos = 0; }
    return ZSTD_ldm_generateSequences(&s->st, &s->store, &s->p, s->bufs[buf] + pos, len);
}

const rawSeq* shim_ldm_seqs(const shim_ldm* s, size_t* nb) { *nb = s->store.size; return s->store.seq; }

void shim_ldm_window(const shim_ldm* s, U32* out)
{
    out[0] = s->st.window.dictLimit; out[1] = s->st.window.lowLimit; out[2] = s->st.loadedDictEnd;
    out[3] = (U32)(s->st.window.nextSrc - s->st.window.base); out[4] = s->st.window.nbOverflowCorrections;
}

const ldmEntry_t* shim_ldm_table(const shim_ldm* s) { return s->st.hashTable; }
const BYTE* shim_ldm_bucket_offsets(const shim_ldm* s) { return s->st.bucketOffsets; }

/* ── ZSTD_ldm_blockCompress, on the match state of a real context ── */

typedef struct {
    ZSTD_CCtx* cctx;
    BYTE* dict;
    BYTE* src;
    RawSeqStore_t store;
    U32 rep[ZSTD_REP_NUM];
} shim_blk;

/* cp: windowLog, chainLog, hashLog, searchLog, minMatch, targetLength, strategy. Rewritten with what is applied. */
shim_blk* shim_blk_new(U32* cp, int useRow, const void* dict, size_t dictSize, const void* src, size_t srcSize,
                       const rawSeq* seqs, size_t nbSeqs)
{
    shim_blk* s = (shim_blk*)calloc(1, sizeof(*s));
    ZSTD_CCtx* c = ZSTD_createCCtx();
    char tmp[64];
    s->cctx = c;
    s->dict = (BYTE*)malloc(dictSize + 64); memcpy(s->dict, dict, dictSize);
    s->src = (BYTE*)malloc(srcSize + 64); memcpy(s->src, src, srcSize);
    s->store.seq = (rawSeq*)malloc((nbSeqs + 1) * sizeof(rawSeq)); memcpy(s->store.seq, seqs, nbSeqs * sizeof(rawSeq));
    s->store.size = s->store.capacity = nbSeqs;
    ZSTD_CCtx_setParameter(c, ZSTD_c_windowLog, (int)cp[0]);
    ZSTD_CCtx_setParameter(c, ZSTD_c_chainLog, (int)cp[1]);
    ZSTD_CCtx_setParameter(c, ZSTD_c_hashLog, (int)cp[2]);
    ZSTD_CCtx_setParameter(c, ZSTD_c_searchLog, (int)cp[3]);
    ZSTD_CCtx_setParameter(c, ZSTD_c_minMatch, (int)cp[4]);
    ZSTD_CCtx_setParameter(c, ZSTD_c_targetLength, (int)cp[5]);
    ZSTD_CCtx_setParameter(c, ZSTD_c_strategy, (int)cp[6]);
    ZSTD_CCtx_setParameter(c, ZSTD_c_useRowMatchFinder, useRow ? ZSTD_ps_enable : ZSTD_ps_disable);
    ZSTD_CCtx_setPledgedSrcSize(c, srcSize);
    if (dictSize) ZSTD_CCtx_refPrefix(c, s->dict, dictSize);
    {   ZSTD_inBuffer in = { s->src, 0, 0 };
        ZSTD_outBuffer out = { tmp, sizeof(tmp), 0 };
        if (ZSTD_isError(ZSTD_compressStream2(c, &out, &in, ZSTD_e_continue))) abort();
    }
    {   ZSTD_compressionParameters const a = c->appliedParams.cParams;
        cp[0] = a.windowLog; cp[1] = a.chainLog; cp[2] = a.hashLog; cp[3] = a.searchLog; cp[4] = a.minMatch;
        cp[5] = a.targetLength; cp[6] = (U32)a.strategy;
    }
    memcpy(s->rep, c->blockState.prevCBlock->rep, sizeof(s->rep));
    {   ZSTD_MatchState_t* const ms = &c->blockState.matchState;
        if (!ZSTD_window_update(&ms->window, s->src, srcSize, ms->forceNonContiguous)) {
            ms->forceNonContiguous = 0;
            ms->nextToUpdate = ms->window.dictLimit;
        }
    }
    return s;
}

void shim_blk_free(shim_blk* s)
{
    ZSTD_freeCCtx(s->cctx); free(s->dict); free(s->src); free(s->store.seq); free(s);
}

size_t shim_blk_max_block(const shim_blk* s) { return s->cctx->blockSizeMax; }

/* What ZSTD_compress_frameChunk and ZSTD_buildSeqStore do for a block, with the sequences as external ones. */
size_t shim_blk_run(shim_blk* s, size_t pos, size_t blockSize)
{
    ZSTD_CCtx* const zc = s->cctx;
    ZSTD_MatchState_t* const ms = &zc->blockState.matchState;
    const BYTE* const ip = s->src + pos;
    U32 const maxDist = (U32)1 << zc->appliedParams.cParams.windowLog;
    size_t lastLL;
    ZSTD_checkDictValidity(&ms->window, ip + blockSize, maxDist, &ms->loadedDictEnd, &ms->dictMatchState);
    ZSTD_window_enforceMaxDist(&ms->window, ip, maxDist, &ms->loadedDictEnd, &ms->dictMatchState);
    if (ms->nextToUpdate < ms->window.lowLimit) ms->nextToUpdate = ms->window.lowLimit;

    ZSTD_resetSeqStore(&zc->seqStore);
    if (blockSize < MIN_CBLOCK_SIZE+ZSTD_blockHeaderSize+1+1) {
        if (zc->appliedParams.cParams.strategy >= ZSTD_btopt) {
            ZSTD_ldm_skipRawSeqStoreBytes(&s->store, blockSize);
        } else {
            ZSTD_ldm_skipSequences(&s->store, blockSize, zc->appliedParams.cParams.minMatch);
        }
        return 0;
    }
    ms->opt.symbolCosts = &zc->blockState.prevCBlock->entropy;
    ms->opt.literalCompressionMode = zc->appliedParams.literalCompressionMode;
    {   U32 const curr = (U32)(ip - ms->window.base);
        if (curr > ms->nextToUpdate + 384)
            ms->nextToUpdate = curr - MIN(192, (U32)(curr - ms->nextToUpdate - 384));
    }
    lastLL = ZSTD_ldm_blockCompress(&s->store, ms, &zc->seqStore, s->rep, zc->appliedParams.useRowMatchFinder, ip, blockSize);
    if (ZSTD_isError(lastLL)) return lastLL;
    memcpy(zc->seqStore.lit, ip + blockSize - lastLL, lastLL);
    zc->seqStore.lit += lastLL;
    return lastLL;
}

const SeqDef* shim_blk_seqs(const shim_blk* s, size_t* nb)
{
    *nb = (size_t)(s->cctx->seqStore.sequences - s->cctx->seqStore.sequencesStart);
    return s->cctx->seqStore.sequencesStart;
}
const BYTE* shim_blk_literals(const shim_blk* s, size_t* nb)
{
    *nb = (size_t)(s->cctx->seqStore.lit - s->cctx->seqStore.litStart);
    return s->cctx->seqStore.litStart;
}
/* longLengthType, longLengthPos, rep[3], nextToUpdate */
void shim_blk_state(const shim_blk* s, U32* out)
{
    out[0] = (U32)s->cctx->seqStore.longLengthType; out[1] = s->cctx->seqStore.longLengthPos;
    out[2] = s->rep[0]; out[3] = s->rep[1]; out[4] = s->rep[2];
    out[5] = s->cctx->blockState.matchState.nextToUpdate;
}
const RawSeqStore_t* shim_blk_store(const shim_blk* s) { return &s->store; }
