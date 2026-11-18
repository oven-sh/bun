// Runs on the machine that builds: trains a zstd dictionary on a list of items and makes a frame of each with it.
//
//   compress <items> <frames> <dictionary>
//
// A list is a u32 count, a u32 size for each entry, then the entries. The output follows from the input and the
// pinned zstd alone.

#define _GNU_SOURCE // makes cover.c call qsort_r on every host
#define _CRT_SECURE_NO_WARNINGS
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define COMPRESSION_LEVEL 19
#define DICTIONARY_CAPACITY (128 * 1024)
// Within 0.3% of the best that a search over both finds.
#define SEGMENT_SIZE 256
#define MATCH_SIZE 8

static void fail(const char* what, const char* why)
{
    fprintf(stderr, "error: %s: %s\n", what, why);
    exit(1);
}

static void* allocate(size_t size)
{
    void* block = malloc(size);
    if (!block)
        fail("malloc", "out of memory");
    return block;
}

static int hasSorted;

// Stable, by the little-endian value of the MATCH_SIZE bytes at each position.
static void sortPositions(uint32_t* positions, size_t count, const uint8_t* bytes)
{
    static size_t starts[0x10001];
    uint32_t* from = positions;
    uint32_t* to = allocate(count * sizeof(uint32_t));
    for (const uint8_t* digit = bytes; digit < bytes + MATCH_SIZE; digit += 2) {
        memset(starts, 0, sizeof(starts));
        for (size_t i = 0; i < count; i++)
            starts[(digit[from[i]] | digit[from[i] + 1] << 8) + 1]++;
        for (size_t i = 1; i < 0x10000; i++)
            starts[i] += starts[i - 1];
        for (size_t i = 0; i < count; i++)
            to[starts[digit[from[i]] | digit[from[i] + 1] << 8]++] = from[i];
        uint32_t* sorted = to;
        to = from;
        from = sorted;
    }
    _Static_assert(MATCH_SIZE % 4 == 0, "an even number of passes ends in `positions`");
    free(to);
    hasSorted = 1;
}

// zstd's trainer needs a stable sort and takes the C library's, with which the dictionary would differ by host.
#define qsort_r(...) sortPositions(ctx->suffix, ctx->suffixSize, ctx->samples)
#define ZSTD_STATIC_LINKING_ONLY
#include "dictBuilder/cover.c"

static size_t checked(const char* what, size_t result)
{
    if (ZSTD_isError(result))
        fail(what, ZSTD_getErrorName(result));
    return result;
}

static FILE* openFile(const char* path, const char* mode)
{
    FILE* file = fopen(path, mode);
    if (!file)
        fail(path, "cannot be opened");
    return file;
}

static void* readBytes(FILE* file, size_t size)
{
    void* bytes = allocate(size);
    if (fread(bytes, 1, size, file) != size)
        fail("items", "the list ends early");
    return bytes;
}

static void writeFile(const char* path, const void* bytes, size_t size)
{
    FILE* file = openFile(path, "wb");
    if (fwrite(bytes, 1, size, file) != size || fclose(file))
        fail(path, "cannot be written");
}

int main(int argc, char** argv)
{
    if (argc != 4)
        fail("usage", "compress <items> <frames> <dictionary>");

    FILE* input = openFile(argv[1], "rb");
    const uint32_t count = MEM_readLE32(readBytes(input, 4));
    const uint8_t* sizeTable = readBytes(input, 4 * (size_t)count);
    size_t* sizes = allocate(count * sizeof(size_t));
    size_t total = 0;
    size_t capacity = 4 + 4 * (size_t)count;
    for (uint32_t i = 0; i < count; i++) {
        sizes[i] = MEM_readLE32(sizeTable + 4 * (size_t)i);
        total += sizes[i];
        capacity += ZSTD_compressBound(sizes[i]);
    }
    const uint8_t* item = readBytes(input, total);

    void* dictionary = allocate(DICTIONARY_CAPACITY);
    const ZDICT_cover_params_t parameters = { .k = SEGMENT_SIZE, .d = MATCH_SIZE, .zParams.compressionLevel = COMPRESSION_LEVEL };
    const size_t dictionarySize = checked("training", ZDICT_trainFromBuffer_cover(dictionary, DICTIONARY_CAPACITY, item, sizes, count, parameters));
    if (!hasSorted)
        fail("training", "cover.c no longer sorts with qsort_r");
    writeFile(argv[3], dictionary, dictionarySize);

    ZSTD_CCtx* context = ZSTD_createCCtx();
    ZSTD_CDict* prepared = ZSTD_createCDict(dictionary, dictionarySize, COMPRESSION_LEVEL);
    if (!context || !prepared)
        fail("zstd", "out of memory");
    checked("dictionary", ZSTD_CCtx_refCDict(context, prepared));
    // There is one dictionary, so no frame has to name it.
    checked("parameter", ZSTD_CCtx_setParameter(context, ZSTD_c_dictIDFlag, 0));

    uint8_t* frames = allocate(capacity);
    size_t end = 4 + 4 * (size_t)count;
    MEM_writeLE32(frames, count);
    for (uint32_t i = 0; i < count; item += sizes[i++]) {
        const size_t size = checked("compression", ZSTD_compress2(context, frames + end, capacity - end, item, sizes[i]));
        MEM_writeLE32(frames + 4 + 4 * (size_t)i, (uint32_t)size);
        end += size;
    }
    writeFile(argv[2], frames, end);
    return 0;
}
