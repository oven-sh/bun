// File generated via `make static-hash-table` / `make cpp`
static const struct CompactHashIndex processBindingConstantsTableIndex[17] = {
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 2, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 0, 16 },
    { -1, -1 },
    { -1, -1 },
    { 4, -1 },
    { 3, -1 },
};

static const struct HashTableValue processBindingConstantsTableValues[5] = {
   { "os"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, processBindingConstantsGetOs } },
   { "fs"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, processBindingConstantsGetFs } },
   { "crypto"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, processBindingConstantsGetCrypto } },
   { "zlib"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, processBindingConstantsGetZlib } },
   { "trace"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, processBindingConstantsGetTrace } },
};

static const struct HashTable processBindingConstantsTable =
    { 5, 15, false, nullptr, processBindingConstantsTableValues, processBindingConstantsTableIndex };
