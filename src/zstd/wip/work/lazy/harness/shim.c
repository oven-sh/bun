// Exposes the internal state of the C library to the differential tests.
#define ZSTD_STATIC_LINKING_ONLY
#include "compress/zstd_compress_internal.h"

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
}

void shim_collect(ZSTD_CCtx* c, ZSTD_Sequence* seqs, size_t cap) {
    c->seqCollector.collectSequences = 1;
    c->seqCollector.seqStart = seqs;
    c->seqCollector.seqIndex = 0;
    c->seqCollector.maxSequences = cap;
}
size_t shim_collected(const ZSTD_CCtx* c) { return c->seqCollector.seqIndex; }
