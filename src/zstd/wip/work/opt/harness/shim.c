// Exposes the internal state of the C library to the differential tests.
#define ZSTD_STATIC_LINKING_ONLY
#include "compress/zstd_compress_internal.h"
#include <stdlib.h>
#include <string.h>

typedef struct {
    unsigned cp[7];
    unsigned useRow;
    unsigned hasDms;
    unsigned nextToUpdate, loadedDictEnd, lowLimit, dictLimit, rowHashLog, hashSaltEntropy, lazySkipping;
    unsigned long long hashSalt;
    unsigned hashCache[8];
    unsigned rep[3];
    const unsigned* hashTable;
    const unsigned* chainTable;
    const unsigned char* tagTable;
    const unsigned* hashTable3;
    unsigned hashLog3;
    unsigned sums[8];
    const unsigned* freqs[4];
} ShimState;

void shim_state(const ZSTD_CCtx* c, ShimState* s) {
    const ZSTD_MatchState_t* ms = &c->blockState.matchState;
    const ZSTD_compressionParameters* p = &c->appliedParams.cParams;
    int i;
    s->cp[0] = p->windowLog; s->cp[1] = p->chainLog; s->cp[2] = p->hashLog; s->cp[3] = p->searchLog;
    s->cp[4] = p->minMatch; s->cp[5] = p->targetLength; s->cp[6] = (unsigned)p->strategy;
    s->useRow = c->appliedParams.useRowMatchFinder == ZSTD_ps_enable;
    s->hasDms = ms->dictMatchState != NULL;
    s->nextToUpdate = ms->nextToUpdate; s->loadedDictEnd = ms->loadedDictEnd;
    s->lowLimit = ms->window.lowLimit; s->dictLimit = ms->window.dictLimit;
    s->rowHashLog = ms->rowHashLog; s->hashSaltEntropy = ms->hashSaltEntropy; s->lazySkipping = (unsigned)ms->lazySkipping;
    s->hashSalt = ms->hashSalt;
    for (i = 0; i < 8; i++) s->hashCache[i] = ms->hashCache[i];
    for (i = 0; i < 3; i++) s->rep[i] = c->blockState.prevCBlock->rep[i];
    s->hashTable = ms->hashTable; s->chainTable = ms->chainTable; s->tagTable = ms->tagTable;
    s->hashTable3 = ms->hashTable3; s->hashLog3 = ms->hashLog3;
    s->sums[0] = ms->opt.litSum; s->sums[1] = ms->opt.litLengthSum; s->sums[2] = ms->opt.matchLengthSum; s->sums[3] = ms->opt.offCodeSum;
    s->sums[4] = ms->opt.litSumBasePrice; s->sums[5] = ms->opt.litLengthSumBasePrice; s->sums[6] = ms->opt.matchLengthSumBasePrice; s->sums[7] = ms->opt.offCodeSumBasePrice;
    s->freqs[0] = ms->opt.litFreq; s->freqs[1] = ms->opt.litLengthFreq; s->freqs[2] = ms->opt.matchLengthFreq; s->freqs[3] = ms->opt.offCodeFreq;
}

typedef struct {
    unsigned long long huf[257];
    unsigned ll[36], ml[53], of[32];   /* deltaNbBits */
} ShimEntropy;

static void shim_poke_fse(FSE_CTable* ct, unsigned tableLog, unsigned maxSymbol, const unsigned* deltaNbBits) {
    FSE_symbolCompressionTransform* tt = (FSE_symbolCompressionTransform*)(ct + 1 + (1 << (tableLog - 1)));
    unsigned s;
    ((U16*)ct)[0] = (U16)tableLog; ((U16*)ct)[1] = (U16)maxSymbol;
    for (s = 0; s <= maxSymbol; s++) { tt[s].deltaNbBits = deltaNbBits[s]; tt[s].deltaFindState = 0; }
}

/* A frame by the block-level API, with what the public parameters cannot set: exact parameters, sequences that stand
 * for those of long distance matching, the entropy tables of a dictionary. `cdict` or `dict` or none. */
size_t shim_frame2(ZSTD_CCtx* c, const unsigned cp[7], const void* dict, size_t dictSize, const ZSTD_CDict* cdict,
                   int litMode, rawSeq* seqs, size_t nbSeqs, const ShimEntropy* e,
                   ZSTD_Sequence* out, size_t outCap, const void* first, size_t firstSize, const void* src, size_t srcSize)
{
    size_t const cap = ZSTD_compressBound(srcSize + firstSize);
    void* const dst = malloc(cap);
    size_t r;
    if (cdict) {
        ZSTD_frameParameters fp = { 0, 0, 0 };
        r = ZSTD_compressBegin_usingCDict_advanced(c, cdict, fp, ZSTD_CONTENTSIZE_UNKNOWN);
    } else {
        ZSTD_parameters p;
        memset(&p, 0, sizeof(p));
        p.cParams.windowLog = cp[0]; p.cParams.chainLog = cp[1]; p.cParams.hashLog = cp[2]; p.cParams.searchLog = cp[3];
        p.cParams.minMatch = cp[4]; p.cParams.targetLength = cp[5]; p.cParams.strategy = (ZSTD_strategy)cp[6];
        r = ZSTD_compressBegin_advanced(c, dict, dictSize, p, srcSize + firstSize);
    }
    if (ZSTD_isError(r)) { free(dst); return r; }
    c->appliedParams.postBlockSplitter = ZSTD_ps_disable;
    c->appliedParams.literalCompressionMode = (ZSTD_ParamSwitch_e)litMode;
    if (nbSeqs) ZSTD_referenceExternalSequences(c, seqs, nbSeqs);
    if (e) {
        ZSTD_entropyCTables_t* t = &c->blockState.prevCBlock->entropy;
        memcpy(t->huf.CTable, e->huf, sizeof(e->huf));
        t->huf.repeatMode = HUF_repeat_valid;
        shim_poke_fse(t->fse.litlengthCTable, LLFSELog, MaxLL, e->ll);
        shim_poke_fse(t->fse.matchlengthCTable, MLFSELog, MaxML, e->ml);
        shim_poke_fse(t->fse.offcodeCTable, OffFSELog, MaxOff, e->of);
    }
    c->seqCollector.collectSequences = 1;
    c->seqCollector.seqStart = out;
    c->seqCollector.seqIndex = 0;
    c->seqCollector.maxSequences = outCap;
    r = firstSize ? ZSTD_compressContinue_public(c, dst, cap, first, firstSize) : 0;
    if (!ZSTD_isError(r)) r = ZSTD_compressEnd_public(c, dst, cap, src, srcSize);
    free(dst);
    c->seqCollector.collectSequences = 0;
    if (ZSTD_isError(r)) return r;
    return c->seqCollector.seqIndex;
}
