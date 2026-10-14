// fu-shapes.d.ts: the shapes of fuse.js 7.0.0, dist/fuse.mjs, read off original.js. "birth N" = the line of original.js where the literal's `{` stands.
// Behind the namespace: C every line to copy · D births without an interface, and what births.txt gets wrong · E the border: who takes what from outside · F idioms.
//
// ANNOTATORS, BEFORE ANYTHING ELSE
// 1. `python3 trial/apply.py NN` (from the project folder) writes all of section C into parts/NN.mts. The four pieces together: 0 errors, verify PASS, and `bang` has nothing left to do.
// 2. `x!` THROWS at run time when x is null or undefined, and `bang` puts it wherever the checker asks, true or not. Two places hold undefined in an ordinary run. They get a cast to any, never `!`:
//      1429  (weight || 1) * (ignoreFieldNorm ? 1 : norm/*$*/ as any/*$*/)   an entry out of a carried index may lack n: npm computes NaN and goes on
//      1461  if (match.idx/*$*/ as any/*$*/ > -1) {                          every match that is not inside an array has no idx: npm compares undefined > -1: false
//    Tried on the test tree with `!` made a real check: `match.idx!` breaks 54 of its 218 lines, `norm!` one. The 12 `!` and the 3 casts to a shape that section C does have never fired.
// 3. Do not add `| undefined` to Alphabet, KeyMap, KeysMap, ResultMap, RecordEntries, BitRow or Bit[]. A missing key, a hole and an element past the end are the undefined that TypeScript itself leaves out
//    of an element read; the engine lets that one travel (`x & undefined`, `!undefined`, `undefined << 1` compute as in JavaScript). Written into the type it would call for a `!`, and the `!` would throw:
//    642 charMatch is undefined for every character of the text that the pattern lacks. Leave `let charMatch` and `let match` (513) without an annotation.
// 4. bitArr and lastBitArr are FU.BitRow = number[], NOT int32[]: see BitRow.
declare namespace FU {
  // ---------------------------------------------------------------------------------------------------------------------
  // 1. Numbers. An int32 takes four bytes; storing anything else there throws at run time.
  // ---------------------------------------------------------------------------------------------------------------------
  type int32 = number;
  type DocIndex = int32; // IndexRecord.i, InternalResult.idx, FuseResult.refIndex: where the item stands in the user's list. forEach's index (344 349) or records.length (358); `-= 1` at 372. A carried index brings its own: section E
  type ItemIndex = int32; // ArrayEntry.i, Match.idx, ResultMatch.refIndex, StackItem.nestedArrIndex: where a string stands in its array. forEach's index (425); -1 for the stack's first item (407)
  type KeyIndex = int32; // where a key stands in FuseIndex.keys: KeysMap's values, the keys of RecordEntries
  type TextIndex = int32; // a position in a text or a pattern: both halves of a RangeTuple, Chunk.startIndex, what indexOf gives. Negative at 1006 where the text is shorter than the pattern
  type CharMask = int32; // Alphabet's values: made by | and << alone (724)
  type Bit = int32; // an element of matchMask: 1 (587) or +!!x (646)
  type ErrorCount = int32; // ScoreParams.errors: 0..32
  type TokenCount = int32; // the key of norm's cache: match(..).length (289)
  // NOT int32
  type Score = number; // 0 .. 1, fractions, Number.EPSILON ** x; NaN where a norm is missing
  type FieldNorm = number; // 1 / tokens ** (0.5 * weight), three decimals (299)
  type Weight = number; // the user's or 1 (128 144), divided by the sum in the key store (110)
  type UserNumber = number; // location threshold distance minMatchCharLength fieldNormWeight: the user's own number. Fractions and Infinity are legal and work (location 1.5, location Infinity: tried). Operands of the inner loop, so not any: section E
  type BitRow = number[]; // bitArr (636), lastBitArr (596). 638 stores (1 << i) - 1, which at i = 31 is -2147483649: no int32. Reached by a chunk of 32 characters under threshold 1 (tried: it is stored). Every other store is the result of & or |. Born by Array(n): holes

  // ---------------------------------------------------------------------------------------------------------------------
  // GIVEN: what other code makes: `any` under a name. Never put one of these into a union: T | any is any, silently.
  // ---------------------------------------------------------------------------------------------------------------------
  type Given = any; // anything reached from the user's items: what the is* helpers, toString, getTag and deepGet are handed
  type Doc = any; // an item of the user's list: a string or an object; null and undefined are skipped (382 1536)
  type Docs = any; // the user's list itself: Fuse._docs, FuseIndex.docs (undefined in an index made by parseIndex). Kept, pushed to (1540) and spliced (1562) as the caller's own object. May be a proxy or a frozen array, so not Doc[]
  type Options = any; // the bag of new Fuse | Fuse.parseQuery; AND birth 1506 `{ ...Config, ...options }`, Fuse.options: a copy of that bag over Config, with whatever names and values the user wrote. Read a few times a search, never per item
  type GivenIndexOptions = any; // the third argument of Fuse.createIndex, the second of Fuse.parseIndex: { getFn, fieldNormWeight }. Birth 1529 goes in here too
  type SearchOptions = any; // the second argument of fuse.search: { limit }
  type ParseOptions = any; // the third argument of Fuse.parseQuery: { auto }
  type Flag = any; // isCaseSensitive includeScore shouldSort includeMatches findAllMatches useExtendedSearch ignoreLocation ignoreFieldNorm: boolean by the authors' type; the file only ever tests them for truth, so 1, 0 and null work in npm (tried)
  type KeyDef = any; // a key as the user writes it: "a.b" | ["a", "b"] | { name, weight?, getFn? }
  type KeyDefs = any; // options.keys, Fuse.createIndex's first argument: the user's array (frozen in the test tree). Config.keys is the [] of 232
  type GetFn = any; // options.getFn: (doc, path: string[]) => string | string[] | ..: the user's, or `get` (167)
  type KeyGetFn = any; // a key's own getFn: (doc) => ..: the user's function, null (129) or undefined (153)
  type Sortable = any; // what the default sortFn is handed: fuse's own InternalResult, or whatever a user who calls Fuse.config.sortFn hands it: { idx, score }
  type IndexKey = any; // one of IndexKeys, and every place it flows to: FindMatchesArgs.key, Match.key, what computeScore and the transformers read weight | src off
  type IndexKeys = any; // FuseIndex.keys: Key[] where createIndex made them; WHAT setKeys | parseIndex ARE HANDED otherwise: Key-like objects out of JSON, or plain strings (an index written by fuse 6; the authors' own declaration says ReadonlyArray<string>): npm reads key.id off each and goes on
  type SortFn = any; // options.sortFn: (a: InternalResult, b: InternalResult) => number: the user's, or the arrow of 236
  type Predicate = any; // fuse.remove's argument: (doc, idx) => truth
  type FieldValue = any; // what a getFn gives for one key of one item, and every element of it when it is an array (399 410 425)
  type Query = any; // fuse.search's first argument: a string or an Expression; the test tree hands 5 and null as well
  type Expression = any; // { key: pattern } | { $path, $val } | { $and: [..] } | { $or: [..] }: the user's. convertToExplicit (births 1352 1353, computed keys) makes more of the same kind
  type GivenIndexData = any; // Fuse.parseIndex's first argument: { keys, records }: an IndexJSON born here, or what JSON.parse made of one; either member may be missing (322..328 have defaults)
  type GivenIndex = any; // the third argument of new Fuse, the second of setCollection: anything. 1523 throws fuse's own Error unless it is an instance of FuseIndex, so the parameter must let anything in
  type MatcherClass = any; // not given, but no type can say it: `this` of BaseMatch's two static methods (866 869) is one of the eight subclasses ITSELF; multiRegex | singleRegex are its static getters. Once a token

  // ---------------------------------------------------------------------------------------------------------------------
  // 3. Dictionaries, tuples, functions: no layouts
  // ---------------------------------------------------------------------------------------------------------------------
  type KeySrc = string | string[]; // a key's name as the user wrote it; an array is the user's own array. isArray narrows it (160 164)
  type RangeTuple = [start: TextIndex, end: TextIndex]; // births 519 527 807 1101, and 901 928 954 980 1006 1031
  type Indices = RangeTuple[] | RangeTuple; // SearchResult.indices and all it flows into. A LIST of ranges from search, both searchIn, FuzzyMatch and IncludeMatch; ONE range from the six exact matchers (901 ..1031). 1280 tells them apart by the class's `type`: section F
  type KeyMap = { [id: string]: Key }; // birth 95: KeyStore._keyMap
  type KeysMap = { [id: string]: KeyIndex }; // birth 330: FuseIndex._keysMap
  type Alphabet = { [char: string]: CharMask }; // birth 720. Read for every character of every text (642)
  type RecordEntries = { [keyIndex: number]: RecordEntry | ArrayEntry[] }; // birth 395 (the inner {}): IndexRecord.$. A key whose value is missing or blank has no entry. isArray tells the two apart (1732)
  type ResultMap = { [idx: number]: InternalResult }; // birth 1667
  type Transformer = (result: InternalResult, data: FuseResult) => void; // transformMatches, transformScore (1483 1484)

  // ---------------------------------------------------------------------------------------------------------------------
  // 4. Keys and the configuration
  // ---------------------------------------------------------------------------------------------------------------------
  // Two sets of keys are made from the same options.keys: the key store's (100: weights divided) and the index's (460: weights as written). An index from outside brings its own: section E.
  // getFn is optional because JSON drops it: born with all five members; a carried key has four when getFn was undefined or a function, five when it was null (tried).
  interface Key { path: string[]; id: string; weight: Weight; src: KeySrc; getFn?: KeyGetFn } // birth 156. path: split's result, or the user's own array (160)
  interface MatchOptions { includeMatches: Flag; findAllMatches: Flag; minMatchCharLength: UserNumber } // birth 213
  interface BasicOptions { isCaseSensitive: Flag; includeScore: Flag; keys: KeyDefs; shouldSort: Flag; sortFn: SortFn } // birth 225
  interface FuzzyOptions { location: UserNumber; threshold: UserNumber; distance: UserNumber } // birth 240
  interface AdvancedOptions { useExtendedSearch: Flag; getFn: GetFn; ignoreLocation: Flag; ignoreFieldNorm: Flag; fieldNormWeight: UserNumber } // birth 254
  // The four above spread in this order. Handed out as Fuse.config: the user reads, enumerates and STORES to it (Fuse.config.threshold = 0 in the test tree). Read here only as the default of a missing option.
  interface Config { // birth 272
    isCaseSensitive: Flag;
    includeScore: Flag;
    keys: KeyDefs;
    shouldSort: Flag;
    sortFn: SortFn;
    includeMatches: Flag;
    findAllMatches: Flag;
    minMatchCharLength: UserNumber;
    location: UserNumber;
    threshold: UserNumber;
    distance: UserNumber;
    useExtendedSearch: Flag;
    getFn: GetFn;
    ignoreLocation: Flag;
    ignoreFieldNorm: Flag;
    fieldNormWeight: UserNumber;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // 5. The index. Born here, OR handed in from outside (section E): the types say what a carried index holds as well.
  // ---------------------------------------------------------------------------------------------------------------------
  interface Norm { get: (value: string) => FieldNorm; clear: () => void } // birth 287: two closures over one cache. Members, not methods: a layout of two slots
  // An element of FuseIndex.records. The authors have two types, a string's { v, i, n } (386) and an object's { i, $ } (395). One array holds both: index.add(doc) picks by the doc, whatever the list held before (360),
  // and the readers tell them apart by reading the other kind's member and finding undefined (1608: v; 1671 1697: $). So: one interface, one layout; what a birth lacks is optional.
  interface IndexRecord { v?: string; i: DocIndex; n?: FieldNorm; $?: RecordEntries } // birth 386 395
  // What stands in $. Two interfaces on purpose: no variable holds both (1732 branches first), and most entries are the small one. n is optional for an index from outside alone (the test tree's "norms missing").
  interface ArrayEntry { v: string; i: ItemIndex; n?: FieldNorm } // birth 417: one string of a value that is an array, however deep
  interface RecordEntry { v: string; n?: FieldNorm } // birth 435: a value that is one string
  interface StackItem { nestedArrIndex: ItemIndex; value: FieldValue } // birth 407 426
  interface IndexJSON { keys: IndexKeys; records: IndexRecord[] } // birth 447: toJSON's result: the index's own two arrays, handed to the user. What comes back in is GivenIndexData
  interface IndexOptions { getFn?: GetFn; fieldNormWeight?: UserNumber } // birth 459 471: the FuseIndex constructor's bag; `= {}` is its default, so both are optional. The class is not exported: only these two births arrive

  // ---------------------------------------------------------------------------------------------------------------------
  // 6. The bitap search: the inner loops
  // ---------------------------------------------------------------------------------------------------------------------
  // computeScore$1's second argument: made for every step of the binary search and every hit (574 lacks errors). Optional throughout: the parameter's default is {}.
  // The locations are numbers, not int32: expectedLocation is the user's location clamped to 0..text.length (558), 1.5 stays 1.5.
  interface ScoreParams { errors?: ErrorCount; currentLocation?: number; expectedLocation?: number; distance?: UserNumber; ignoreLocation?: Flag } // birth 574 610 659 686
  // What search (701), both searchIn and every matcher's search give: thirteen births, one layout, taken apart at once by the caller. indices is stored behind the birth at 712 807 855 1302, written in the literal at 898 ..1106.
  interface SearchResult { isMatch: boolean; score: Score; indices?: Indices } // birth 701 801 849 898 925 951 977 1003 1028 1106 1248 1296 1310
  interface BitapOptions { location: UserNumber; threshold: UserNumber; distance: UserNumber; includeMatches: Flag; findAllMatches: Flag; minMatchCharLength: UserNumber; isCaseSensitive: Flag; ignoreLocation: Flag } // birth 744: BitapSearch.options: read for every text (793 814)
  interface Chunk { pattern: string; alphabet: Alphabet; startIndex: TextIndex } // birth 764
  interface BitapParams { location?: number; distance?: UserNumber; threshold?: UserNumber; findAllMatches?: Flag; minMatchCharLength?: UserNumber; includeMatches?: Flag; ignoreLocation?: Flag } // birth 828: search's fourth argument, one a chunk a text; all seven are always there, optional because the default is {}

  // ---------------------------------------------------------------------------------------------------------------------
  // 7. Searchers, matchers, the parsed query
  // ---------------------------------------------------------------------------------------------------------------------
  interface ExtendedOptions { isCaseSensitive: Flag; includeMatches: Flag; minMatchCharLength: UserNumber; findAllMatches: Flag; ignoreLocation: Flag; location: UserNumber; threshold: UserNumber; distance: UserNumber } // birth 1225: ExtendedSearch.options: BitapOptions' members in another order; nothing goes from one to the other
  // No births: views of the file's own classes, which an ambient file cannot name. Methods only, so any object that has the method fits.
  interface Searcher { searchIn(text: string): SearchResult } // BitapSearch (730) | ExtendedSearch (1210): createSearcher's result
  interface Matcher { search(text: string): SearchResult } // the eight subclasses of BaseMatch (882 ..1078): an element of ExtendedSearch.query
  interface LogicalOperators { AND: '$and'; OR: '$or' } // birth 1334: never stored to
  interface KeyTypes { PATH: '$path'; PATTERN: '$val' } // birth 1339: never stored to
  // parse's tree. Two literals: a leaf { keyId, pattern } (1379; searcher stored at 1385 unless auto is false) and a branch { children, operator } (1391). children holds both, evaluate's `node` is either,
  // and 1631 tells them apart by reading children off a leaf. So: one interface, one layout. Always born here: fuse.search parses afresh; Fuse.parseQuery only hands the tree out.
  interface QueryNode { keyId?: string; pattern?: string; searcher?: Searcher; children?: QueryNode[]; operator?: string } // birth 1379 1391

  // ---------------------------------------------------------------------------------------------------------------------
  // 8. Results
  // ---------------------------------------------------------------------------------------------------------------------
  // Three literals, one array (InternalResult.matches): 1618 (a list of strings) has neither key nor idx, 1757 no idx. The user's sortFn sees them.
  // key: the index's key (1707) or the key store's (1635), which is undefined when a carried index knows a key that options.keys lacks. norm and indices are written by all three and may hold undefined.
  interface Match { score: Score; key?: IndexKey; value: string; idx?: ItemIndex; norm: FieldNorm | undefined; indices: Indices | undefined } // birth 1618 1741 1757
  // One for every item that matches. score is stored by computeScore (1433) ahead of the sort. item is never read here again: a string's text, or the record's $. The user's sortFn sees it.
  // THE ORDER: 1642 1677 1715 write idx, item, matches; 1615 (a list of strings) writes item, idx, matches. One variable holds both (1579), so one order had to give way: it shows only to a sortFn that enumerates its argument.
  interface InternalResult { idx: DocIndex; item: string | RecordEntries; matches: Match[]; score?: Score } // birth 1615 1642 1677 1715
  interface FindMatchesArgs { key: IndexKey; value: RecordEntry | ArrayEntry[] | undefined; searcher: Searcher } // birth 1634 1706: one for every key of every record
  // What the user gets. Members stored behind the birth, in this order: ResultMatch key (1458) refIndex (1462); FuseResult matches (1439) score (1470). Printed by JSON.stringify: order and absence show.
  interface ResultMatch { indices: Indices; value: string; key?: KeySrc; refIndex?: ItemIndex } // birth 1452
  interface FuseResult { item: Doc; refIndex: DocIndex; matches?: ResultMatch[]; score?: Score } // birth 1489
  interface ScoreOptions { ignoreFieldNorm?: Flag } // birth 1585: computeScore's second argument: undefined when the user wrote undefined
  interface FormatOptions { includeMatches?: Flag; includeScore?: Flag } // birth 1595: format's third argument
}

// ---------------------------------------------------------------------------------------------------------------------
// C. Every line that changes, so that the four pieces agree: `//@ <line of original.js> <the line as it is to stand>`. 214 lines; `python3 trial/apply.py NN` writes them.
//    Not listed = nothing to add: inference gets it right.
// ---------------------------------------------------------------------------------------------------------------------
// ---- piece 00: lines 1..502
//@   10 function isArray(value: FU.Given): value is any[] {
//@   18 function baseToString(value: FU.Given): string {
//@   27 function toString(value: FU.Given): string {
//@   31 function isString(value: FU.Given): value is string {
//@   35 function isNumber(value: FU.Given): value is number {
//@   40 function isBoolean(value: FU.Given): boolean {
//@   48 function isObject(value: FU.Given): boolean {
//@   53 function isObjectLike(value: FU.Given): boolean {
//@   57 function isDefined<T>(value: T): value is NonNullable<T> {
//@   61 function isBlank(value: string): boolean {
//@   67 function getTag(value: FU.Given): string {
//@   79 const LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY = (key: FU.Given) =>
//@   82 const PATTERN_LENGTH_TOO_LARGE = (max: FU.int32) =>
//@   85 const MISSING_KEY_PROPERTY = (name: string) => `Missing ${name} property in key`;
//@   87 const INVALID_KEY_WEIGHT_VALUE = (key: FU.Given) =>
//@   92 class KeyStore { /*$*/declare _keys: FU.Key[]; declare _keyMap: FU.KeyMap;/*$*/
//@   93 constructor(keys: FU.KeyDefs) {
//@   99 keys.forEach((key: FU.KeyDef) => {
//@  109 this._keys.forEach((key: FU.Key) => {
//@  113 get(keyId: string): FU.Key | undefined {
//@  116 keys(): FU.Key[] {
//@  119 toJSON(): string {
//@  124 function createKey(key: FU.KeyDef): FU.Key {
//@  125 let path: string[] | null = null;
//@  126 let id: string | null = null;
//@  127 let src: FU.KeySrc | null = null;
//@  128 let weight: FU.Weight = 1;
//@  129 let getFn: FU.KeyGetFn = null;
//@  140 const name: FU.KeySrc = key.name;
//@  159 function createKeyPath(key: FU.KeySrc): string[] {
//@  163 function createKeyId(key: FU.KeySrc): string {
//@  167 function get(obj: FU.Doc, path: FU.KeySrc): FU.FieldValue {
//@  168 let list: FU.Given[] = [];
//@  171 const deepGet = (obj: FU.Given, path: string[], index: FU.int32): void => {
//@  213 const MatchOptions: FU.MatchOptions = {
//@  225 const BasicOptions: FU.BasicOptions = {
//@  236 sortFn: (a: FU.InternalResult, b: FU.InternalResult): FU.int32 =>
//@  237 a.score === b.score ? (a.idx < b.idx ? -1 : 1) : a.score! < b.score! ? -1 : 1
//@  240 const FuzzyOptions: FU.FuzzyOptions = {
//@  254 const AdvancedOptions: FU.AdvancedOptions = {
//@  272 var Config: FU.Config = {
//@  283 function norm(weight: FU.UserNumber = 1, mantissa: FU.int32 = 3): FU.Norm {
//@  284 const cache = new Map<FU.TokenCount, FU.FieldNorm>();
//@  288 get(value: string): FU.FieldNorm {
//@  289 const numTokens = value.match(SPACE)!.length;
//@  292 return cache.get(numTokens)!
//@  299 const n = parseFloat(Math.round(norm * m) / m/*$*/ as any/*$*/);
//@  305 clear(): void {
//@  311 class FuseIndex { /*$*/declare norm: FU.Norm; declare getFn: FU.GetFn; declare isCreated: boolean; declare records: FU.IndexRecord[]; declare keys: FU.Key[]; declare _keysMap: FU.KeysMap; declare docs: FU.Docs;/*$*/
//@  315 }: FU.IndexOptions = {}) {
//@  322 setSources(docs: FU.Docs = []) {
//@  325 setIndexRecords(records: FU.IndexRecord[] = []) {
//@  328 setKeys(keys: FU.Key[] = []) {
//@  331 keys.forEach((key: FU.Key, idx: FU.KeyIndex) => {
//@  344 this.docs.forEach((doc: FU.Doc, docIndex: FU.DocIndex) => {
//@  349 this.docs.forEach((doc: FU.Doc, docIndex: FU.DocIndex) => {
//@  357 add(doc: FU.Doc) {
//@  367 removeAt(idx: number) {
//@  375 getValueForItemAtKeyId(item: FU.RecordEntries, keyId: string): FU.RecordEntry | FU.ArrayEntry[] | undefined {
//@  378 size(): FU.int32 {
//@  381 _addString(doc: string | null | undefined, docIndex: FU.DocIndex) {
//@  386 let record: FU.IndexRecord = {
//@  394 _addObject(doc: FU.Doc, docIndex: FU.DocIndex) {
//@  395 let record: FU.IndexRecord = { i: docIndex, $: {} };
//@  398 this.keys.forEach((key: FU.Key, keyIndex: FU.KeyIndex) => {
//@  399 let value: FU.FieldValue = key.getFn ? key.getFn(doc) : this.getFn(doc, key.path);
//@  406 let subRecords: FU.ArrayEntry[] = [];
//@  407 const stack: FU.StackItem[] = [{ nestedArrIndex: -1, value }];
//@  410 const { nestedArrIndex, value } = stack.pop()!;
//@  417 let subRecord: FU.ArrayEntry = {
//@  425 value.forEach((item: FU.FieldValue, k: FU.ItemIndex) => {
//@  433 record.$![keyIndex] = subRecords;
//@  435 let subRecord: FU.RecordEntry = {
//@  440 record.$![keyIndex] = subRecord;
//@  446 toJSON(): FU.IndexJSON {
//@  455 keys: FU.KeyDefs,
//@  456 docs: FU.Docs,
//@  457 { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight }: FU.GivenIndexOptions = {}
//@  467 data: FU.GivenIndexData,
//@  468 { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight }: FU.GivenIndexOptions = {}
//@  478 pattern: string,
//@  485 }: FU.ScoreParams = {}
//@  486 ): FU.Score {
// ---- piece 01: lines 503..986
//@  504 matchmask: FU.Bit[] = [],
//@  505 minMatchCharLength: FU.UserNumber = Config.minMatchCharLength
//@  506 ): FU.RangeTuple[] {
//@  507 let indices: FU.RangeTuple[] = [];
//@  537 text: string,
//@  538 pattern: string,
//@  539 patternAlphabet: FU.Alphabet,
//@  548 }: FU.BitapParams = {}
//@  549 ): FU.SearchResult {
//@  568 const matchMask: FU.Bit[] = computeMatches ? Array(textLen) : [];
//@  570 let index: FU.TextIndex;
//@  596 let lastBitArr: FU.BitRow = [];
//@  636 let bitArr: FU.BitRow = Array(finish + 2);
//@  701 const result: FU.SearchResult = {
//@  719 function createPatternAlphabet(pattern: string): FU.Alphabet {
//@  720 let mask: FU.Alphabet = {};
//@  730 class BitapSearch { /*$*/declare options: FU.BitapOptions; declare pattern: string; declare chunks: FU.Chunk[];/*$*/
//@  732 pattern: string,
//@  742 }: FU.Options = {}
//@  763 const addChunk = (pattern: string, startIndex: FU.TextIndex) => {
//@  792 searchIn(text: string): FU.SearchResult {
//@  801 let result: FU.SearchResult = {
//@  823 let allIndices: FU.RangeTuple[] = [];
//@  827 this.chunks.forEach(({ pattern, alphabet, startIndex }: FU.Chunk) => {
//@  845 allIndices = [...allIndices, ...indices/*$*/ as FU.RangeTuple[]/*$*/];
//@  849 let result: FU.SearchResult = {
//@  862 class BaseMatch { /*$*/declare pattern: string;/*$*/
//@  863 constructor(pattern: string) {
//@  866 static isMultiMatch(this: FU.MatcherClass, pattern: string) {
//@  869 static isSingleMatch(this: FU.MatcherClass, pattern: string) {
//@  872 /*$*/search(text: string): void;/*$*/ search(/*text*/) {}
//@  875 function getMatch(pattern: string, exp: RegExp): string | null {
//@  883 constructor(pattern: string) {
//@  895 search(text: string): FU.SearchResult {
//@  909 constructor(pattern: string) {
//@  921 search(text: string): FU.SearchResult {
//@  936 constructor(pattern: string) {
//@  948 search(text: string): FU.SearchResult {
//@  962 constructor(pattern: string) {
//@  974 search(text: string): FU.SearchResult {
// ---- piece 02: lines 987..1468
//@  988 constructor(pattern: string) {
//@ 1000 search(text: string): FU.SearchResult {
//@ 1014 constructor(pattern: string) {
//@ 1026 search(text: string): FU.SearchResult {
//@ 1036 class FuzzyMatch extends BaseMatch { /*$*/declare _bitapSearch: BitapSearch;/*$*/
//@ 1038 pattern: string,
//@ 1048 }: FU.Options = {}
//@ 1071 search(text: string): FU.SearchResult {
//@ 1079 constructor(pattern: string) {
//@ 1091 search(text: string): FU.SearchResult {
//@ 1093 let index: FU.TextIndex;
//@ 1095 const indices: FU.RangeTuple[] = [];
//@ 1135 function parseQuery(pattern: string, options: FU.Options = {}): FU.Matcher[][] {
//@ 1136 return pattern.split(OR_TOKEN).map((item: string) => {
//@ 1140 .filter((item: string) => item && !!item.trim());
//@ 1142 let results: FU.Matcher[] = [];
//@ 1210 class ExtendedSearch { /*$*/declare query: FU.Matcher[][] | null; declare options: FU.ExtendedOptions; declare pattern: string;/*$*/
//@ 1212 pattern: string,
//@ 1222 }: FU.Options = {}
//@ 1240 static condition(_: string, options: FU.Options): FU.Flag {
//@ 1244 searchIn(text: string): FU.SearchResult {
//@ 1259 let allIndices: FU.RangeTuple[] = [];
//@ 1279 const type = /*$*/(/*$*/searcher.constructor/*$*/ as any)/*$*/.type;
//@ 1281 allIndices = [...allIndices, ...indices/*$*/ as FU.RangeTuple[]/*$*/];
//@ 1283 allIndices.push(indices/*$*/ as FU.RangeTuple/*$*/);
//@ 1296 let result: FU.SearchResult = {
//@ 1317 const registeredSearchers: (typeof ExtendedSearch)[] = [];
//@ 1319 function register(...args: (typeof ExtendedSearch)[]) {
//@ 1323 function createSearcher(pattern: string, options: FU.Options): FU.Searcher {
//@ 1334 const LogicalOperator: FU.LogicalOperators = {
//@ 1339 const KeyType: FU.KeyTypes = {
//@ 1344 const isExpression = (query: FU.Expression): boolean =>
//@ 1347 const isPath = (query: FU.Expression): boolean => !!query[KeyType.PATH];
//@ 1349 const isLeaf = (query: FU.Expression): boolean =>
//@ 1352 const convertToExplicit = (query: FU.Expression): FU.Expression => ({
//@ 1353 [LogicalOperator.AND]: Object.keys(query).map((key: string) => ({
//@ 1360 function parse(query: FU.Expression, options: FU.Options, { auto = true }: FU.ParseOptions = {}): FU.QueryNode {
//@ 1361 const next = (query: FU.Expression): FU.QueryNode => {
//@ 1379 const obj: FU.QueryNode = {
//@ 1391 let node: FU.QueryNode = {
//@ 1396 keys.forEach((key: string) => {
//@ 1400 value.forEach((item: FU.Expression) => {
//@ 1401 node.children!.push(next(item));
//@ 1418 results: FU.InternalResult[],
//@ 1419 { ignoreFieldNorm = Config.ignoreFieldNorm }: FU.ScoreOptions
//@ 1421 results.forEach((result: FU.InternalResult) => {
//@ 1424 result.matches.forEach(({ key, norm, score }: FU.Match) => {
//@ 1429 (weight || 1) * (ignoreFieldNorm ? 1 : norm/*$*/ as any/*$*/)
//@ 1437 function transformMatches(result: FU.InternalResult, data: FU.FuseResult) {
//@ 1445 matches.forEach((match: FU.Match) => {
//@ 1452 let obj: FU.ResultMatch = {
//@ 1461 if (match.idx/*$*/ as any/*$*/ > -1) {
//@ 1465 data.matches!.push(obj);
// ---- piece 03: lines 1469..1779
//@ 1469 function transformScore(result: FU.InternalResult, data: FU.FuseResult) {
//@ 1474 results: FU.InternalResult[],
//@ 1475 docs: FU.Docs,
//@ 1479 }: FU.FormatOptions = {}
//@ 1480 ): FU.FuseResult[] {
//@ 1481 const transformers: FU.Transformer[] = [];
//@ 1486 return results.map((result: FU.InternalResult): FU.FuseResult => {
//@ 1489 const data: FU.FuseResult = {
//@ 1495 transformers.forEach((transformer: FU.Transformer) => {
//@ 1504 class Fuse { /*$*/declare static version: string; declare static createIndex: typeof createIndex; declare static parseIndex: typeof parseIndex; declare static config: FU.Config; declare static parseQuery: typeof parse; declare options: FU.Options; declare _keyStore: KeyStore; declare _docs: FU.Docs; declare _myIndex: FuseIndex;/*$*/
//@ 1505 constructor(docs: FU.Docs, options: FU.Options = {}, index?: FU.GivenIndex) {
//@ 1520 setCollection(docs: FU.Docs, index?: FU.GivenIndex) {
//@ 1535 add(doc: FU.Doc) {
//@ 1544 remove(predicate: FU.Predicate = (/* doc, idx */) => false) {
//@ 1545 const results: FU.Doc[] = [];
//@ 1561 removeAt(idx: number) {
//@ 1570 search(query: FU.Query, { limit = -1 }: FU.SearchOptions = {}): FU.FuseResult[] {
//@ 1601 _searchStringList(query: string): FU.InternalResult[] {
//@ 1604 const results: FU.InternalResult[] = [];
//@ 1607 records.forEach(({ v: text, i: idx, n: norm }: FU.IndexRecord) => {
//@ 1626 _searchLogical(query: FU.Expression): FU.InternalResult[] {
//@ 1630 const evaluate = (node: FU.QueryNode, item: FU.RecordEntries, idx: FU.DocIndex): FU.InternalResult[] => {
//@ 1635 key: this._keyStore.get(keyId!),
//@ 1636 value: this._myIndex.getValueForItemAtKeyId(item, keyId!),
//@ 1637 searcher/*$*/: searcher!/*$*/
//@ 1653 const res: FU.InternalResult[] = [];
//@ 1667 const resultMap: FU.ResultMap = {};
//@ 1668 const results: FU.InternalResult[] = [];
//@ 1670 records.forEach(({ $: item, i: idx }: FU.IndexRecord) => {
//@ 1680 expResults.forEach(({ matches }: FU.InternalResult) => {
//@ 1690 _searchObjectList(query: string): FU.InternalResult[] {
//@ 1693 const results: FU.InternalResult[] = [];
//@ 1696 records.forEach(({ $: item, i: idx }: FU.IndexRecord) => {
//@ 1701 let matches: FU.Match[] = [];
//@ 1704 keys.forEach((key: FU.Key, keyIndex: FU.KeyIndex) => {
//@ 1725 _findMatches({ key, value, searcher }: FU.FindMatchesArgs): FU.Match[] {
//@ 1730 let matches: FU.Match[] = [];
//@ 1733 value.forEach(({ v: text, i: idx, n: norm }: FU.ArrayEntry) => {

// ---------------------------------------------------------------------------------------------------------------------
// D. Births without an interface, on purpose; and births.txt against the file
// ---------------------------------------------------------------------------------------------------------------------
// 1051 { location .. ignoreLocation }: FuzzyMatch's bag for new BitapSearch, whose second parameter also takes the user's bag (1331): FU.Options. Taken apart at once, once a token.
// 1529 { getFn, fieldNormWeight }: goes into createIndex's third parameter, which is public: FU.GivenIndexOptions.
// 1506 { ...Config, ...options }: FU.Options: the user's names and values.
// 1352 1353 { [LogicalOperator.AND]: .. } { [key]: query[key] }: computed keys: FU.Expression, the same kind of thing as the user's query.
// 95 330 395 720 1667 {}: dictionaries (section 3). The `= {}` in a parameter list: the default of a bag.
// births.txt MISSES, because a comment or a method stands inside the literal: 213 225 240 254 (the four groups of options) · 287 (norm's { get, clear }) · 701 (search's own result). They have interfaces above.
// births.txt MISSES every class (its list of constructors is empty: these are `class`, not functions): KeyStore 92 · FuseIndex 311 · BitapSearch 730 · BaseMatch 862 and its eight · ExtendedSearch 1210 · Fuse 1504.
//   Their fields are declared on the line of the class's `{`, in the order the constructor stores them: section C. A class is its own type: write KeyStore, FuseIndex, BitapSearch in the text.
// births.txt LISTS AS BIRTHS what are destructuring patterns: 827 1424 1607 1670 1680 1696 1725 1733. Section C writes the shape each one reads behind it.

// ---------------------------------------------------------------------------------------------------------------------
// E. The border: who takes what from outside
// ---------------------------------------------------------------------------------------------------------------------
// STAYS any ALL THE WAY: the list and its items (Docs Doc Given FieldValue) · every options bag · key definitions · the query expression · the callbacks.
//   new Fuse(docs, options, index) · setCollection(docs, index) · add(doc) · remove(predicate) · search(query, { limit }) · Fuse.createIndex(keys, docs, options) · Fuse.parseIndex(data, options) · Fuse.parseQuery(query, options, { auto })
//   FuseIndex: setSources(docs) · add(doc) · _addObject(doc, ..)        inside: KeyStore's constructor · createKey · get and deepGet (obj) · format (docs) · the is* helpers, toString, baseToString, getTag
//   options: createSearcher · the constructors of BitapSearch, ExtendedSearch, FuzzyMatch · parseQuery · ExtendedSearch.condition · parse        the query: parse, next, isExpression, isPath, isLeaf, convertToExplicit, _searchLogical
// THREE DOORS: a value from outside enters a place typed as something created here. The parameter or field is typed; the call hands it an any; no cast is written.
//   1  325 FuseIndex.setIndexRecords(records: FU.IndexRecord[])   from 473 (data.records) or the user's own call. The array is KEPT: removeAt splices the caller's own array (the test tree looks: "11 of 12").
//   2  328 FuseIndex.setKeys(keys: FU.Key[])                      from 472 (data.keys) or the user's own call. From 460 as well: keys born here, in an array that the user's array's own map() made.
//   3 1527 this._myIndex = index || createIndex(..)               index is FU.GivenIndex; 1523 has thrown unless it is an instance of FuseIndex.
//   Why the records are not given for all that: they are what a search reads, for every item: given, this typing would be for nothing. Instead the types admit all that fuse itself writes and JSON carries:
//   a carried record and entry has every member it was born with; a carried key lacks getFn at most. A program that never calls parseIndex has no door 1 or 2 at all.
//   Not admitted, a TypeError of ours: records that are no records (the tree's { i: "one", $: 5 }, null, 7: npm throws a TypeError there as well) · keys that are strings, as the authors' own stale
//   declaration of setKeys and toJSON has it (`ReadonlyArray<string>`; fuse 6's format): npm 7.0.0 searches on with weight 1 and no key name in the matches.
// PRIMITIVES THAT ARE TESTED WHERE THEY ENTER (a value of another kind: a TypeError of ours; what npm does stands behind it):
//   744 1225 the four numbers of the options, stored into BitapOptions | ExtendedOptions, at the first search (npm: "0.4" and null are coerced and work) · 316 fieldNormWeight · 140 a key's name (npm: TypeError at split)
//   144 a key's weight (npm: "2" concatenates) · 367 1561 removeAt(idx: number) · 381 _addString's doc (npm: TypeError at trim) · 167 get's path, called by the user as Fuse.config.getFn · 792 1244 searchIn's text, through Fuse.parseQuery's searchers
//   1380 createKeyId(key): the user's $path (npm: 5 stays 5 and finds nothing).
// HANDED OUT, and may be stored to by the user: Fuse.config (Config) · getIndex() (FuseIndex) · toJSON() (IndexJSON, Key, IndexRecord, the entries) · the results (FuseResult, ResultMatch)
//   · a and b of the user's sortFn (InternalResult, Match, Key) · key.path, to the user's getFn · Fuse.parseQuery's tree (QueryNode, the searchers).
//   The default sortFn (236) is public as Fuse.config.sortFn; what a user's own sortFn hands on to it is what it was handed.

// ---------------------------------------------------------------------------------------------------------------------
// F. Idioms, all tried on the checker
// ---------------------------------------------------------------------------------------------------------------------
// isString | isNumber | isArray are type predicates and isDefined is `<T>(value: T): value is NonNullable<T>`: each is true exactly when the function says true. They do nearly all the narrowing:
//   1608 1734 text · 1671 1697 item · 1726 value, then 1732 isArray(value): ArrayEntry[], else RecordEntry · 1446 match.indices, and the pattern of 1450 sees it narrowed · 131 key · 416 434 value.
// 872 BaseMatch.search takes no parameter and the subclasses' take one: TS2416. A signature in front of it, which emits nothing: `/*$*/search(text: string): void;/*$*/ search(/*text*/) {}`.
// 1637 a shorthand member cannot carry a `!`: `searcher/*$*/: searcher!/*$*/`. True: fuse.search parses with auto on. 1635 1636 keyId!: a leaf always has one. (TS2345: `bang` does not put these three.)
// 845 1281 `...indices/*$*/ as FU.RangeTuple[]/*$*/` · 1283 `push(indices/*$*/ as FU.RangeTuple/*$*/)`: the only casts to a shape. They run with includeMatches alone.
// 1279 `/*$*/(/*$*/searcher.constructor/*$*/ as any)/*$*/.type`: a static getter of the matcher's class.
// 299 parseFloat is handed a number: `Math.round(norm * m) / m/*$*/ as any/*$*/`. Once for each count of tokens.
// 140 `const name: FU.KeySrc = key.name`: without it `src = name` stores an any and src stays `KeySrc | null` at 156.
// 376 item[this._keysMap[keyId]]: for a key that is not indexed the inner read gives undefined and so does the outer: as it stands, no cast (head, point 3). The tree has it: "a query for a key that is not indexed".
// 1504 the five statics stored at 1765..1771 are declared like fields: `declare static version: string; ..`.
// 1115 searchers, 1180 MultiMatchSet, 279 1129 the regular expressions, 17 75 77 534 1126 1130 the constants: inference. `new searcher(token, options)` on the union of the eight classes passes as it is.
