// CHANGED: this is dist/fuse.mjs of fuse.js 7.0.0 with TypeScript types added. No code was changed. See NOTICE.

/**
 * Fuse.js v7.0.0 - Lightweight fuzzy-search (http://fusejs.io)
 *
 * Copyright (c) 2023 Kiro Risk (http://kiro.me)
 * All Rights Reserved. Apache Software License 2.0
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

function isArray<T>(value: FU.OnlyGiven<T>): boolean; function isArray(value: unknown): value is any[]; function isArray(value: FU.Given): boolean {
  return !Array.isArray
    ? getTag(value) === '[object Array]'
    : Array.isArray(value)
}

// Adapted from: https://github.com/lodash/lodash/blob/master/.internal/baseToString.js
const INFINITY = 1 / 0;
function baseToString(value: FU.Given): string {
  // Exit early for strings to avoid a performance hit in some environments.
  if (typeof value == 'string') {
    return value
  }
  let result = value + '';
  return result == '0' && 1 / value == -INFINITY ? '-0' : result
}

function toString(value: FU.Given): string {
  return value == null ? '' : baseToString(value)
}

function isString(value: FU.Given): value is string {
  return typeof value === 'string'
}

function isNumber(value: FU.Given): value is number {
  return typeof value === 'number'
}

// Adapted from: https://github.com/lodash/lodash/blob/master/isBoolean.js
function isBoolean(value: FU.Given): boolean {
  return (
    value === true ||
    value === false ||
    (isObjectLike(value) && getTag(value) == '[object Boolean]')
  )
}

function isObject(value: FU.Given): boolean {
  return typeof value === 'object'
}

// Checks if `value` is object-like.
function isObjectLike(value: FU.Given): boolean {
  return isObject(value) && value !== null
}

function isDefined<T>(value: T): value is NonNullable<T> {
  return value !== undefined && value !== null
}

function isBlank(value: FU.Given): boolean {
  return !value.trim().length
}

// Gets the `toStringTag` of `value`.
// Adapted from: https://github.com/lodash/lodash/blob/master/.internal/getTag.js
function getTag(value: FU.Given): string {
  return value == null
    ? value === undefined
      ? '[object Undefined]'
      : '[object Null]'
    : Object.prototype.toString.call(value)
}

const EXTENDED_SEARCH_UNAVAILABLE = 'Extended search is not available';

const INCORRECT_INDEX_TYPE = "Incorrect 'index' type";

const LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY = (key: FU.Given) =>
  `Invalid value for key ${key}`;

const PATTERN_LENGTH_TOO_LARGE = (max: FU.int32) =>
  `Pattern length exceeds max of ${max}.`;

const MISSING_KEY_PROPERTY = (name: string) => `Missing ${name} property in key`;

const INVALID_KEY_WEIGHT_VALUE = (key: FU.KeySrc) =>
  `Property 'weight' in key '${key}' must be a positive integer`;

const hasOwn = Object.prototype.hasOwnProperty;

class KeyStore { declare _keys: FU.Key[]; declare _keyMap: FU.KeyMap;
  constructor(keys: FU.KeyDefs) {
    this._keys = [];
    this._keyMap = {};

    let totalWeight = 0;

    keys.forEach((key: FU.KeyDef) => {
      let obj = createKey(key);

      this._keys.push(obj);
      this._keyMap[obj.id] = obj;

      totalWeight += obj.weight;
    });

    // Normalize weights so that their sum is equal to 1
    this._keys.forEach((key: FU.Key) => {
      key.weight /= totalWeight;
    });
  }
  get(keyId: string): FU.Key | undefined {
    return this._keyMap[keyId]
  }
  keys(): FU.Key[] {
    return this._keys
  }
  toJSON(): string {
    return JSON.stringify(this._keys)
  }
}

function createKey(key: FU.KeyDef): FU.Key {
  let path: string[] | null = null;
  let id: string | null = null;
  let src: FU.KeySrc | null = null;
  let weight: FU.Weight = 1;
  let getFn: FU.KeyGetFn = null;

  if (isString(key) || isArray(key)) {
    src = key as FU.KeySrc;
    path = createKeyPath(key);
    id = createKeyId(key);
  } else {
    if (!hasOwn.call(key, 'name')) {
      throw new Error(MISSING_KEY_PROPERTY('name'))
    }

    const name: FU.KeySrc = key.name;
    src = name;

    if (hasOwn.call(key, 'weight')) {
      weight = key.weight;

      if (weight <= 0) {
        throw new Error(INVALID_KEY_WEIGHT_VALUE(name))
      }
    }

    path = createKeyPath(name);
    id = createKeyId(name);
    getFn = key.getFn;
  }

  return { path, id, weight, src, getFn }
}

function createKeyPath(key: FU.KeySrc): string[] {
  return isArray(key) ? key : key.split('.')
}

function createKeyId(key: FU.KeySrc): string {
  return isArray(key) ? key.join('.') : key
}

function get(obj: FU.Doc, path: FU.KeySrc): FU.FieldValue {
  let list: FU.Given[] = [];
  let arr = false;

  const deepGet = (obj: FU.Given, path: string[], index: FU.int32): void => {
    if (!isDefined(obj)) {
      return
    }
    if (!path[index]) {
      // If there's no path left, we've arrived at the object we care about.
      list.push(obj);
    } else {
      let key = path[index];

      const value = obj[key];

      if (!isDefined(value)) {
        return
      }

      // If we're at the last value in the path, and if it's a string/number/bool,
      // add it to the list
      if (
        index === path.length - 1 &&
        (isString(value) || isNumber(value) || isBoolean(value))
      ) {
        list.push(toString(value));
      } else if (isArray(value)) {
        arr = true;
        // Search each item in the array.
        for (let i = 0, len = value.length; i < len; i += 1) {
          deepGet(value[i], path, index + 1);
        }
      } else if (path.length) {
        // An object. Recurse further.
        deepGet(value, path, index + 1);
      }
    }
  };

  // Backwards compatibility (since path used to be a string)
  deepGet(obj, isString(path) ? path.split('.') : path, 0);

  return arr ? list : list[0]
}

const MatchOptions: FU.MatchOptions = {
  // Whether the matches should be included in the result set. When `true`, each record in the result
  // set will include the indices of the matched characters.
  // These can consequently be used for highlighting purposes.
  includeMatches: false,
  // When `true`, the matching function will continue to the end of a search pattern even if
  // a perfect match has already been located in the string.
  findAllMatches: false,
  // Minimum number of characters that must be matched before a result is considered a match
  minMatchCharLength: 1
};

const BasicOptions: FU.BasicOptions = {
  // When `true`, the algorithm continues searching to the end of the input even if a perfect
  // match is found before the end of the same input.
  isCaseSensitive: false,
  // When true, the matching function will continue to the end of a search pattern even if
  includeScore: false,
  // List of properties that will be searched. This also supports nested properties.
  keys: [],
  // Whether to sort the result list, by score
  shouldSort: true,
  // Default sort function: sort by ascending score, ascending index
  sortFn: (a: FU.Sortable, b: FU.Sortable): FU.int32 =>
    a.score === b.score ? (a.idx < b.idx ? -1 : 1) : a.score! < b.score! ? -1 : 1
};

const FuzzyOptions: FU.FuzzyOptions = {
  // Approximately where in the text is the pattern expected to be found?
  location: 0,
  // At what point does the match algorithm give up. A threshold of '0.0' requires a perfect match
  // (of both letters and location), a threshold of '1.0' would match anything.
  threshold: 0.6,
  // Determines how close the match must be to the fuzzy location (specified above).
  // An exact letter match which is 'distance' characters away from the fuzzy location
  // would score as a complete mismatch. A distance of '0' requires the match be at
  // the exact location specified, a threshold of '1000' would require a perfect match
  // to be within 800 characters of the fuzzy location to be found using a 0.8 threshold.
  distance: 100
};

const AdvancedOptions: FU.AdvancedOptions = {
  // When `true`, it enables the use of unix-like search commands
  useExtendedSearch: false,
  // The get function to use when fetching an object's properties.
  // The default will search nested paths *ie foo.bar.baz*
  getFn: get,
  // When `true`, search will ignore `location` and `distance`, so it won't matter
  // where in the string the pattern appears.
  // More info: https://fusejs.io/concepts/scoring-theory.html#fuzziness-score
  ignoreLocation: false,
  // When `true`, the calculation for the relevance score (used for sorting) will
  // ignore the field-length norm.
  // More info: https://fusejs.io/concepts/scoring-theory.html#field-length-norm
  ignoreFieldNorm: false,
  // The weight to determine how much field length norm effects scoring.
  fieldNormWeight: 1
};

var Config: FU.Config = {
  ...BasicOptions,
  ...MatchOptions,
  ...FuzzyOptions,
  ...AdvancedOptions
};

const SPACE = /[^ ]+/g;

// Field-length norm: the shorter the field, the higher the weight.
// Set to 3 decimals to reduce index size.
function norm(weight: FU.UserNumber = 1, mantissa: FU.int32 = 3): FU.Norm {
  const cache = new Map<FU.TokenCount, FU.FieldNorm>();
  const m = Math.pow(10, mantissa);

  return {
    get(value: string): FU.FieldNorm {
      const numTokens = value.match(SPACE)!.length;

      if (cache.has(numTokens)) {
        return cache.get(numTokens)!
      }

      // Default function is 1/sqrt(x), weight makes that variable
      const norm = 1 / Math.pow(numTokens, 0.5 * weight);

      // In place of `toFixed(mantissa)`, for faster computation
      const n = parseFloat(Math.round(norm * m) / m as any);

      cache.set(numTokens, n);

      return n
    },
    clear(): void {
      cache.clear();
    }
  }
}

class FuseIndex { declare norm: FU.Norm; declare getFn: FU.GetFn; declare isCreated: boolean; declare records: FU.IndexRecord[]; declare keys: FU.IndexKeys; declare _keysMap: FU.KeysMap; declare docs: FU.Docs;
  constructor({
    getFn = Config.getFn,
    fieldNormWeight = Config.fieldNormWeight
  }: FU.IndexOptions = {}) {
    this.norm = norm(fieldNormWeight, 3);
    this.getFn = getFn;
    this.isCreated = false;

    this.setIndexRecords();
  }
  setSources(docs: FU.Docs = []) {
    this.docs = docs;
  }
  setIndexRecords(records: FU.IndexRecord[] = []) {
    this.records = records;
  }
  setKeys(keys: FU.IndexKeys = []) {
    this.keys = keys;
    this._keysMap = {};
    keys.forEach((key: FU.Given, idx: FU.KeyIndex) => {
      this._keysMap[key.id] = idx;
    });
  }
  create() {
    if (this.isCreated || !this.docs.length) {
      return
    }

    this.isCreated = true;

    // List is Array<String>
    if (isString(this.docs[0])) {
      this.docs.forEach((doc: FU.Doc, docIndex: FU.DocIndex) => {
        this._addString(doc, docIndex);
      });
    } else {
      // List is Array<Object>
      this.docs.forEach((doc: FU.Doc, docIndex: FU.DocIndex) => {
        this._addObject(doc, docIndex);
      });
    }

    this.norm.clear();
  }
  // Adds a doc to the end of the index
  add(doc: FU.Doc) {
    const idx = this.size();

    if (isString(doc)) {
      this._addString(doc, idx);
    } else {
      this._addObject(doc, idx);
    }
  }
  // Removes the doc at the specified index of the index
  removeAt(idx: number) {
    this.records.splice(idx, 1);

    // Change ref index of every subsquent doc
    for (let i = idx, len = this.size(); i < len; i += 1) {
      this.records[i].i -= 1;
    }
  }
  getValueForItemAtKeyId(item: FU.RecordEntries, keyId: string): FU.RecordEntry | FU.ArrayEntry[] | undefined {
    return item[this._keysMap[keyId]]
  }
  size(): FU.int32 {
    return this.records.length
  }
  _addString(doc: FU.Doc, docIndex: FU.DocIndex) {
    if (!isDefined(doc) || isBlank(doc)) {
      return
    }

    let record: FU.IndexRecord = {
      v: doc,
      i: docIndex,
      n: this.norm.get(doc)
    };

    this.records.push(record);
  }
  _addObject(doc: FU.Doc, docIndex: FU.DocIndex) {
    let record: FU.IndexRecord = { i: docIndex, $: {} };

    // Iterate over every key (i.e, path), and fetch the value at that key
    this.keys.forEach((key: FU.Given, keyIndex: FU.KeyIndex) => {
      let value: FU.FieldValue = key.getFn ? key.getFn(doc) : this.getFn(doc, key.path);

      if (!isDefined(value)) {
        return
      }

      if (isArray(value)) {
        let subRecords: FU.ArrayEntry[] = [];
        const stack: FU.StackItem[] = [{ nestedArrIndex: -1, value }];

        while (stack.length) {
          const { nestedArrIndex, value } = stack.pop()!;

          if (!isDefined(value)) {
            continue
          }

          if (isString(value) && !isBlank(value)) {
            let subRecord: FU.ArrayEntry = {
              v: value,
              i: nestedArrIndex,
              n: this.norm.get(value)
            };

            subRecords.push(subRecord);
          } else if (isArray(value)) {
            value.forEach((item: FU.FieldValue, k: FU.ItemIndex) => {
              stack.push({
                nestedArrIndex: k,
                value: item
              });
            });
          } else ;
        }
        record.$![keyIndex] = subRecords;
      } else if (isString(value) && !isBlank(value)) {
        let subRecord: FU.RecordEntry = {
          v: value,
          n: this.norm.get(value)
        };

        record.$![keyIndex] = subRecord;
      }
    });

    this.records.push(record);
  }
  toJSON(): FU.IndexJSON {
    return {
      keys: this.keys,
      records: this.records
    }
  }
}

function createIndex(
  keys: FU.KeyDefs,
  docs: FU.Docs,
  { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight }: FU.GivenIndexOptions = {}
) {
  const myIndex = new FuseIndex({ getFn, fieldNormWeight });
  myIndex.setKeys(keys.map(createKey));
  myIndex.setSources(docs);
  myIndex.create();
  return myIndex
}

function parseIndex(
  data: FU.GivenIndexData,
  { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight }: FU.GivenIndexOptions = {}
) {
  const { keys, records } = data;
  const myIndex = new FuseIndex({ getFn, fieldNormWeight });
  myIndex.setKeys(keys);
  myIndex.setIndexRecords(records);
  return myIndex
}

function computeScore$1(
  pattern: string,
  {
    errors = 0,
    currentLocation = 0,
    expectedLocation = 0,
    distance = Config.distance,
    ignoreLocation = Config.ignoreLocation
  }: FU.ScoreParams = {}
): FU.Score {
  const accuracy = errors / pattern.length;

  if (ignoreLocation) {
    return accuracy
  }

  const proximity = Math.abs(expectedLocation - currentLocation);

  if (!distance) {
    // Dodge divide by zero error.
    return proximity ? 1.0 : accuracy
  }

  return accuracy + proximity / distance
}
function convertMaskToIndices(
  matchmask: FU.Bit[] = [],
  minMatchCharLength: FU.UserNumber = Config.minMatchCharLength
): FU.RangeTuple[] {
  let indices: FU.RangeTuple[] = [];
  let start = -1;
  let end = -1;
  let i = 0;

  for (let len = matchmask.length; i < len; i += 1) {
    let match = matchmask[i];
    if (match && start === -1) {
      start = i;
    } else if (!match && start !== -1) {
      end = i - 1;
      if (end - start + 1 >= minMatchCharLength) {
        indices.push([start, end]);
      }
      start = -1;
    }
  }

  // (i-1 - start) + 1 => i - start
  if (matchmask[i - 1] && i - start >= minMatchCharLength) {
    indices.push([start, i - 1]);
  }

  return indices
}

// Machine word size
const MAX_BITS = 32;

function search(
  text: string,
  pattern: string,
  patternAlphabet: FU.Alphabet,
  {
    location = Config.location,
    distance = Config.distance,
    threshold = Config.threshold,
    findAllMatches = Config.findAllMatches,
    minMatchCharLength = Config.minMatchCharLength,
    includeMatches = Config.includeMatches,
    ignoreLocation = Config.ignoreLocation
  }: FU.BitapParams = {}
): FU.SearchResult {
  if (pattern.length > MAX_BITS) {
    throw new Error(PATTERN_LENGTH_TOO_LARGE(MAX_BITS))
  }

  const patternLen = pattern.length;
  // Set starting location at beginning text and initialize the alphabet.
  const textLen = text.length;
  // Handle the case when location > text.length
  const expectedLocation = Math.max(0, Math.min(location, textLen));
  // Highest score beyond which we give up.
  let currentThreshold = threshold;
  // Is there a nearby exact match? (speedup)
  let bestLocation = expectedLocation;

  // Performance: only computer matches when the minMatchCharLength > 1
  // OR if `includeMatches` is true.
  const computeMatches = minMatchCharLength > 1 || includeMatches;
  // A mask of the matches, used for building the indices
  const matchMask: FU.Bit[] = computeMatches ? Array<FU.Bit>(textLen) : [];

  let index: FU.TextIndex;

  // Get all exact matches, here for speed up
  while ((index = text.indexOf(pattern, bestLocation)) > -1) {
    let score = computeScore$1(pattern, {
      currentLocation: index,
      expectedLocation,
      distance,
      ignoreLocation
    });

    currentThreshold = Math.min(score, currentThreshold);
    bestLocation = index + patternLen;

    if (computeMatches) {
      let i = 0;
      while (i < patternLen) {
        matchMask[index + i] = 1;
        i += 1;
      }
    }
  }

  // Reset the best location
  bestLocation = -1;

  let lastBitArr: FU.BitRow = [];
  let finalScore = 1;
  let binMax = patternLen + textLen;

  const mask = 1 << (patternLen - 1);

  for (let i = 0; i < patternLen; i += 1) {
    // Scan for the best match; each iteration allows for one more error.
    // Run a binary search to determine how far from the match location we can stray
    // at this error level.
    let binMin = 0;
    let binMid = binMax;

    while (binMin < binMid) {
      const score = computeScore$1(pattern, {
        errors: i,
        currentLocation: expectedLocation + binMid,
        expectedLocation,
        distance,
        ignoreLocation
      });

      if (score <= currentThreshold) {
        binMin = binMid;
      } else {
        binMax = binMid;
      }

      binMid = Math.floor((binMax - binMin) / 2 + binMin);
    }

    // Use the result from this iteration as the maximum for the next.
    binMax = binMid;

    let start = Math.max(1, expectedLocation - binMid + 1);
    let finish = findAllMatches
      ? textLen
      : Math.min(expectedLocation + binMid, textLen) + patternLen;

    // Initialize the bit array
    let bitArr: FU.BitRow = Array<number>(finish + 2);

    bitArr[finish + 1] = (1 << i) - 1;

    for (let j = finish; j >= start; j -= 1) {
      let currentLocation = j - 1;
      let charMatch = patternAlphabet[text.charAt(currentLocation)];

      if (computeMatches) {
        // Speed up: quick bool to int conversion (i.e, `charMatch ? 1 : 0`)
        matchMask[currentLocation] = +!!charMatch;
      }

      // First pass: exact match
      bitArr[j] = ((bitArr[j + 1] << 1) | 1) & charMatch;

      // Subsequent passes: fuzzy match
      if (i) {
        bitArr[j] |=
          ((lastBitArr[j + 1] | lastBitArr[j]) << 1) | 1 | lastBitArr[j + 1];
      }

      if (bitArr[j] & mask) {
        finalScore = computeScore$1(pattern, {
          errors: i,
          currentLocation,
          expectedLocation,
          distance,
          ignoreLocation
        });

        // This match will almost certainly be better than any existing match.
        // But check anyway.
        if (finalScore <= currentThreshold) {
          // Indeed it is
          currentThreshold = finalScore;
          bestLocation = currentLocation;

          // Already passed `loc`, downhill from here on in.
          if (bestLocation <= expectedLocation) {
            break
          }

          // When passing `bestLocation`, don't exceed our current distance from `expectedLocation`.
          start = Math.max(1, 2 * expectedLocation - bestLocation);
        }
      }
    }

    // No hope for a (better) match at greater error levels.
    const score = computeScore$1(pattern, {
      errors: i + 1,
      currentLocation: expectedLocation,
      expectedLocation,
      distance,
      ignoreLocation
    });

    if (score > currentThreshold) {
      break
    }

    lastBitArr = bitArr;
  }

  const result: FU.SearchResult = {
    isMatch: bestLocation >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(0.001, finalScore)
  };

  if (computeMatches) {
    const indices = convertMaskToIndices(matchMask, minMatchCharLength);
    if (!indices.length) {
      result.isMatch = false;
    } else if (includeMatches) {
      result.indices = indices;
    }
  }

  return result
}

function createPatternAlphabet(pattern: string): FU.Alphabet {
  let mask: FU.Alphabet = {};

  for (let i = 0, len = pattern.length; i < len; i += 1) {
    const char = pattern.charAt(i);
    mask[char] = (mask[char] || 0) | (1 << (len - i - 1));
  }

  return mask
}

class BitapSearch { declare options: FU.BitapOptions; declare pattern: string; declare chunks: FU.Chunk[];
  constructor(
    pattern: string,
    {
      location = Config.location,
      threshold = Config.threshold,
      distance = Config.distance,
      includeMatches = Config.includeMatches,
      findAllMatches = Config.findAllMatches,
      minMatchCharLength = Config.minMatchCharLength,
      isCaseSensitive = Config.isCaseSensitive,
      ignoreLocation = Config.ignoreLocation
    }: FU.Options = {}
  ) {
    this.options = {
      location,
      threshold,
      distance,
      includeMatches,
      findAllMatches,
      minMatchCharLength,
      isCaseSensitive,
      ignoreLocation
    };

    this.pattern = isCaseSensitive ? pattern : pattern.toLowerCase();

    this.chunks = [];

    if (!this.pattern.length) {
      return
    }

    const addChunk = (pattern: string, startIndex: FU.TextIndex) => {
      this.chunks.push({
        pattern,
        alphabet: createPatternAlphabet(pattern),
        startIndex
      });
    };

    const len = this.pattern.length;

    if (len > MAX_BITS) {
      let i = 0;
      const remainder = len % MAX_BITS;
      const end = len - remainder;

      while (i < end) {
        addChunk(this.pattern.substr(i, MAX_BITS), i);
        i += MAX_BITS;
      }

      if (remainder) {
        const startIndex = len - MAX_BITS;
        addChunk(this.pattern.substr(startIndex), startIndex);
      }
    } else {
      addChunk(this.pattern, 0);
    }
  }

  searchIn(text: string): FU.SearchResult {
    const { isCaseSensitive, includeMatches } = this.options;

    if (!isCaseSensitive) {
      text = text.toLowerCase();
    }

    // Exact match
    if (this.pattern === text) {
      let result: FU.SearchResult = {
        isMatch: true,
        score: 0
      };

      if (includeMatches) {
        result.indices = [[0, text.length - 1]];
      }

      return result
    }

    // Otherwise, use Bitap algorithm
    const {
      location,
      distance,
      threshold,
      findAllMatches,
      minMatchCharLength,
      ignoreLocation
    } = this.options;

    let allIndices: FU.RangeTuple[] = [];
    let totalScore = 0;
    let hasMatches = false;

    this.chunks.forEach(({ pattern, alphabet, startIndex }: FU.Chunk) => {
      const { isMatch, score, indices } = search(text, pattern, alphabet, {
        location: location + startIndex,
        distance,
        threshold,
        findAllMatches,
        minMatchCharLength,
        includeMatches,
        ignoreLocation
      });

      if (isMatch) {
        hasMatches = true;
      }

      totalScore += score;

      if (isMatch && indices) {
        allIndices = [...allIndices, ...indices as FU.RangeTuple[]];
      }
    });

    let result: FU.SearchResult = {
      isMatch: hasMatches,
      score: hasMatches ? totalScore / this.chunks.length : 1
    };

    if (hasMatches && includeMatches) {
      result.indices = allIndices;
    }

    return result
  }
}

class BaseMatch { declare pattern: string;
  constructor(pattern: string) {
    this.pattern = pattern;
  }
  static isMultiMatch(this: FU.MatcherClass, pattern: string) {
    return getMatch(pattern, this.multiRegex)
  }
  static isSingleMatch(this: FU.MatcherClass, pattern: string) {
    return getMatch(pattern, this.singleRegex)
  }
  search(text: string): void; search(/*text*/) {}
}

function getMatch(pattern: string, exp: RegExp): string | null {
  const matches = pattern.match(exp);
  return matches ? matches[1] : null
}

// Token: 'file

class ExactMatch extends BaseMatch {
  constructor(pattern: string) {
    super(pattern);
  }
  static get type() {
    return 'exact'
  }
  static get multiRegex() {
    return /^="(.*)"$/
  }
  static get singleRegex() {
    return /^=(.*)$/
  }
  search(text: string): FU.SearchResult {
    const isMatch = text === this.pattern;

    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    }
  }
}

// Token: !fire

class InverseExactMatch extends BaseMatch {
  constructor(pattern: string) {
    super(pattern);
  }
  static get type() {
    return 'inverse-exact'
  }
  static get multiRegex() {
    return /^!"(.*)"$/
  }
  static get singleRegex() {
    return /^!(.*)$/
  }
  search(text: string): FU.SearchResult {
    const index = text.indexOf(this.pattern);
    const isMatch = index === -1;

    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, text.length - 1]
    }
  }
}

// Token: ^file

class PrefixExactMatch extends BaseMatch {
  constructor(pattern: string) {
    super(pattern);
  }
  static get type() {
    return 'prefix-exact'
  }
  static get multiRegex() {
    return /^\^"(.*)"$/
  }
  static get singleRegex() {
    return /^\^(.*)$/
  }
  search(text: string): FU.SearchResult {
    const isMatch = text.startsWith(this.pattern);

    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    }
  }
}

// Token: !^fire

class InversePrefixExactMatch extends BaseMatch {
  constructor(pattern: string) {
    super(pattern);
  }
  static get type() {
    return 'inverse-prefix-exact'
  }
  static get multiRegex() {
    return /^!\^"(.*)"$/
  }
  static get singleRegex() {
    return /^!\^(.*)$/
  }
  search(text: string): FU.SearchResult {
    const isMatch = !text.startsWith(this.pattern);

    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, text.length - 1]
    }
  }
}

// Token: .file$
class SuffixExactMatch extends BaseMatch {
  constructor(pattern: string) {
    super(pattern);
  }
  static get type() {
    return 'suffix-exact'
  }
  static get multiRegex() {
    return /^"(.*)"\$$/
  }
  static get singleRegex() {
    return /^(.*)\$$/
  }
  search(text: string): FU.SearchResult {
    const isMatch = text.endsWith(this.pattern);

    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [text.length - this.pattern.length, text.length - 1]
    }
  }
}

// Token: !.file$

class InverseSuffixExactMatch extends BaseMatch {
  constructor(pattern: string) {
    super(pattern);
  }
  static get type() {
    return 'inverse-suffix-exact'
  }
  static get multiRegex() {
    return /^!"(.*)"\$$/
  }
  static get singleRegex() {
    return /^!(.*)\$$/
  }
  search(text: string): FU.SearchResult {
    const isMatch = !text.endsWith(this.pattern);
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, text.length - 1]
    }
  }
}

class FuzzyMatch extends BaseMatch { declare _bitapSearch: BitapSearch;
  constructor(
    pattern: string,
    {
      location = Config.location,
      threshold = Config.threshold,
      distance = Config.distance,
      includeMatches = Config.includeMatches,
      findAllMatches = Config.findAllMatches,
      minMatchCharLength = Config.minMatchCharLength,
      isCaseSensitive = Config.isCaseSensitive,
      ignoreLocation = Config.ignoreLocation
    }: FU.Options = {}
  ) {
    super(pattern);
    this._bitapSearch = new BitapSearch(pattern, {
      location,
      threshold,
      distance,
      includeMatches,
      findAllMatches,
      minMatchCharLength,
      isCaseSensitive,
      ignoreLocation
    });
  }
  static get type() {
    return 'fuzzy'
  }
  static get multiRegex() {
    return /^"(.*)"$/
  }
  static get singleRegex() {
    return /^(.*)$/
  }
  search(text: string): FU.SearchResult {
    return this._bitapSearch.searchIn(text)
  }
}

// Token: 'file

class IncludeMatch extends BaseMatch {
  constructor(pattern: string) {
    super(pattern);
  }
  static get type() {
    return 'include'
  }
  static get multiRegex() {
    return /^'"(.*)"$/
  }
  static get singleRegex() {
    return /^'(.*)$/
  }
  search(text: string): FU.SearchResult {
    let location = 0;
    let index: FU.TextIndex;

    const indices: FU.RangeTuple[] = [];
    const patternLen = this.pattern.length;

    // Get all exact matches
    while ((index = text.indexOf(this.pattern, location)) > -1) {
      location = index + patternLen;
      indices.push([index, location - 1]);
    }

    const isMatch = !!indices.length;

    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices
    }
  }
}

// ❗Order is important. DO NOT CHANGE.
const searchers = [
  ExactMatch,
  IncludeMatch,
  PrefixExactMatch,
  InversePrefixExactMatch,
  InverseSuffixExactMatch,
  SuffixExactMatch,
  InverseExactMatch,
  FuzzyMatch
];

const searchersLen = searchers.length;

// Regex to split by spaces, but keep anything in quotes together
const SPACE_RE = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/;
const OR_TOKEN = '|';

// Return a 2D array representation of the query, for simpler parsing.
// Example:
// "^core go$ | rb$ | py$ xy$" => [["^core", "go$"], ["rb$"], ["py$", "xy$"]]
function parseQuery(pattern: string, options: FU.Options = {}): FU.Matcher[][] {
  return pattern.split(OR_TOKEN).map((item: string) => {
    let query = item
      .trim()
      .split(SPACE_RE)
      .filter((item: string) => item && !!item.trim());

    let results: FU.Matcher[] = [];
    for (let i = 0, len = query.length; i < len; i += 1) {
      const queryItem = query[i];

      // 1. Handle multiple query match (i.e, once that are quoted, like `"hello world"`)
      let found = false;
      let idx = -1;
      while (!found && ++idx < searchersLen) {
        const searcher = searchers[idx];
        let token = searcher.isMultiMatch(queryItem);
        if (token) {
          results.push(new searcher(token, options));
          found = true;
        }
      }

      if (found) {
        continue
      }

      // 2. Handle single query matches (i.e, once that are *not* quoted)
      idx = -1;
      while (++idx < searchersLen) {
        const searcher = searchers[idx];
        let token = searcher.isSingleMatch(queryItem);
        if (token) {
          results.push(new searcher(token, options));
          break
        }
      }
    }

    return results
  })
}

// These extended matchers can return an array of matches, as opposed
// to a singl match
const MultiMatchSet = new Set([FuzzyMatch.type, IncludeMatch.type]);

/**
 * Command-like searching
 * ======================
 *
 * Given multiple search terms delimited by spaces.e.g. `^jscript .python$ ruby !java`,
 * search in a given text.
 *
 * Search syntax:
 *
 * | Token       | Match type                 | Description                            |
 * | ----------- | -------------------------- | -------------------------------------- |
 * | `jscript`   | fuzzy-match                | Items that fuzzy match `jscript`       |
 * | `=scheme`   | exact-match                | Items that are `scheme`                |
 * | `'python`   | include-match              | Items that include `python`            |
 * | `!ruby`     | inverse-exact-match        | Items that do not include `ruby`       |
 * | `^java`     | prefix-exact-match         | Items that start with `java`           |
 * | `!^earlang` | inverse-prefix-exact-match | Items that do not start with `earlang` |
 * | `.js$`      | suffix-exact-match         | Items that end with `.js`              |
 * | `!.go$`     | inverse-suffix-exact-match | Items that do not end with `.go`       |
 *
 * A single pipe character acts as an OR operator. For example, the following
 * query matches entries that start with `core` and end with either`go`, `rb`,
 * or`py`.
 *
 * ```
 * ^core go$ | rb$ | py$
 * ```
 */
class ExtendedSearch { declare query: FU.Matcher[][] | null; declare options: FU.ExtendedOptions; declare pattern: string;
  constructor(
    pattern: string,
    {
      isCaseSensitive = Config.isCaseSensitive,
      includeMatches = Config.includeMatches,
      minMatchCharLength = Config.minMatchCharLength,
      ignoreLocation = Config.ignoreLocation,
      findAllMatches = Config.findAllMatches,
      location = Config.location,
      threshold = Config.threshold,
      distance = Config.distance
    }: FU.Options = {}
  ) {
    this.query = null;
    this.options = {
      isCaseSensitive,
      includeMatches,
      minMatchCharLength,
      findAllMatches,
      ignoreLocation,
      location,
      threshold,
      distance
    };

    this.pattern = isCaseSensitive ? pattern : pattern.toLowerCase();
    this.query = parseQuery(this.pattern, this.options);
  }

  static condition(_: string, options: FU.Options): FU.Flag {
    return options.useExtendedSearch
  }

  searchIn(text: string): FU.SearchResult {
    const query = this.query;

    if (!query) {
      return {
        isMatch: false,
        score: 1
      }
    }

    const { includeMatches, isCaseSensitive } = this.options;

    text = isCaseSensitive ? text : text.toLowerCase();

    let numMatches = 0;
    let allIndices: FU.RangeTuple[] = [];
    let totalScore = 0;

    // ORs
    for (let i = 0, qLen = query.length; i < qLen; i += 1) {
      const searchers = query[i];

      // Reset indices
      allIndices.length = 0;
      numMatches = 0;

      // ANDs
      for (let j = 0, pLen = searchers.length; j < pLen; j += 1) {
        const searcher = searchers[j];
        const { isMatch, indices, score } = searcher.search(text);

        if (isMatch) {
          numMatches += 1;
          totalScore += score;
          if (includeMatches) {
            const type = (searcher.constructor as any).type;
            if (MultiMatchSet.has(type)) {
              allIndices = [...allIndices, ...indices as FU.RangeTuple[]];
            } else {
              allIndices.push(indices as FU.RangeTuple);
            }
          }
        } else {
          totalScore = 0;
          numMatches = 0;
          allIndices.length = 0;
          break
        }
      }

      // OR condition, so if TRUE, return
      if (numMatches) {
        let result: FU.SearchResult = {
          isMatch: true,
          score: totalScore / numMatches
        };

        if (includeMatches) {
          result.indices = allIndices;
        }

        return result
      }
    }

    // Nothing was matched
    return {
      isMatch: false,
      score: 1
    }
  }
}

const registeredSearchers: (typeof ExtendedSearch)[] = [];

function register(...args: (typeof ExtendedSearch)[]) {
  registeredSearchers.push(...args);
}

function createSearcher(pattern: string, options: FU.Options): FU.Searcher {
  for (let i = 0, len = registeredSearchers.length; i < len; i += 1) {
    let searcherClass = registeredSearchers[i];
    if (searcherClass.condition(pattern, options)) {
      return new searcherClass(pattern, options)
    }
  }

  return new BitapSearch(pattern, options)
}

const LogicalOperator: FU.LogicalOperators = {
  AND: '$and',
  OR: '$or'
};

const KeyType: FU.KeyTypes = {
  PATH: '$path',
  PATTERN: '$val'
};

const isExpression = (query: FU.Expression): boolean =>
  !!(query[LogicalOperator.AND] || query[LogicalOperator.OR]);

const isPath = (query: FU.Expression): boolean => !!query[KeyType.PATH];

const isLeaf = (query: FU.Expression): boolean =>
  !isArray(query) && isObject(query) && !isExpression(query);

const convertToExplicit = (query: FU.Expression): FU.Expression => ({
  [LogicalOperator.AND]: Object.keys(query).map((key: string) => ({
    [key]: query[key]
  }))
});

// When `auto` is `true`, the parse function will infer and initialize and add
// the appropriate `Searcher` instance
function parse(query: FU.Expression, options: FU.Options, { auto = true }: FU.ParseOptions = {}): FU.QueryNode {
  const next = (query: FU.Expression): FU.QueryNode => {
    let keys = Object.keys(query);

    const isQueryPath = isPath(query);

    if (!isQueryPath && keys.length > 1 && !isExpression(query)) {
      return next(convertToExplicit(query))
    }

    if (isLeaf(query)) {
      const key = isQueryPath ? query[KeyType.PATH] : keys[0];

      const pattern = isQueryPath ? query[KeyType.PATTERN] : query[key];

      if (!isString(pattern)) {
        throw new Error(LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY(key))
      }

      const obj: FU.QueryNode = {
        keyId: createKeyId(key),
        pattern
      };

      if (auto) {
        obj.searcher = createSearcher(pattern, options);
      }

      return obj
    }

    let node: FU.QueryNode = {
      children: [],
      operator: keys[0]
    };

    keys.forEach((key: string) => {
      const value = query[key];

      if (isArray(value)) {
        value.forEach((item: FU.Expression) => {
          node.children!.push(next(item));
        });
      }
    });

    return node
  };

  if (!isExpression(query)) {
    query = convertToExplicit(query);
  }

  return next(query)
}

// Practical scoring function
function computeScore(
  results: FU.InternalResult[],
  { ignoreFieldNorm = Config.ignoreFieldNorm }: FU.ScoreOptions
) {
  results.forEach((result: FU.InternalResult) => {
    let totalScore = 1;

    result.matches.forEach(({ key, norm, score }: FU.Match) => {
      const weight = key ? key.weight : null;

      totalScore *= Math.pow(
        score === 0 && weight ? Number.EPSILON : score,
        (weight || 1) * (ignoreFieldNorm ? 1 : norm as any)
      );
    });

    result.score = totalScore;
  });
}

function transformMatches(result: FU.InternalResult, data: FU.FuseResult) {
  const matches = result.matches;
  data.matches = [];

  if (!isDefined(matches)) {
    return
  }

  matches.forEach((match: FU.Match) => {
    if (!isDefined(match.indices) || !match.indices.length) {
      return
    }

    const { indices, value } = match;

    let obj: FU.ResultMatch = {
      indices,
      value
    };

    if (match.key) {
      obj.key = match.key.src;
    }

    if (match.idx as any > -1) {
      obj.refIndex = match.idx;
    }

    data.matches!.push(obj);
  });
}
function transformScore(result: FU.InternalResult, data: FU.FuseResult) {
  data.score = result.score;
}

function format(
  results: FU.InternalResult[],
  docs: FU.Docs,
  {
    includeMatches = Config.includeMatches,
    includeScore = Config.includeScore
  }: FU.FormatOptions = {}
): FU.FuseResult[] {
  const transformers: FU.Transformer[] = [];

  if (includeMatches) transformers.push(transformMatches);
  if (includeScore) transformers.push(transformScore);

  return results.map((result: FU.InternalResult): FU.FuseResult => {
    const { idx } = result;

    const data: FU.FuseResult = {
      item: docs[idx],
      refIndex: idx
    };

    if (transformers.length) {
      transformers.forEach((transformer: FU.Transformer) => {
        transformer(result, data);
      });
    }

    return data
  })
}

class Fuse { declare static version: string; declare static createIndex: typeof createIndex; declare static parseIndex: typeof parseIndex; declare static config: FU.Config; declare static parseQuery: typeof parse; declare options: FU.Options; declare _keyStore: KeyStore; declare _docs: FU.Docs; declare _myIndex: FuseIndex;
  constructor(docs: FU.Docs, options: FU.Options = {}, index?: FU.GivenIndex) {
    this.options = { ...Config, ...options };

    if (
      this.options.useExtendedSearch &&
      !true
    ) {
      throw new Error(EXTENDED_SEARCH_UNAVAILABLE)
    }

    this._keyStore = new KeyStore(this.options.keys);

    this.setCollection(docs, index);
  }

  setCollection(docs: FU.Docs, index?: FU.GivenIndex) {
    this._docs = docs;

    if (index && !(index instanceof FuseIndex)) {
      throw new Error(INCORRECT_INDEX_TYPE)
    }

    this._myIndex =
      index ||
      createIndex(this.options.keys, this._docs, {
        getFn: this.options.getFn,
        fieldNormWeight: this.options.fieldNormWeight
      });
  }

  add(doc: FU.Doc) {
    if (!isDefined(doc)) {
      return
    }

    this._docs.push(doc);
    this._myIndex.add(doc);
  }

  remove(predicate: FU.Predicate = (/* doc, idx */) => false) {
    const results: FU.Doc[] = [];

    for (let i = 0, len = this._docs.length; i < len; i += 1) {
      const doc = this._docs[i];
      if (predicate(doc, i)) {
        this.removeAt(i);
        i -= 1;
        len -= 1;

        results.push(doc);
      }
    }

    return results
  }

  removeAt(idx: number) {
    this._docs.splice(idx, 1);
    this._myIndex.removeAt(idx);
  }

  getIndex() {
    return this._myIndex
  }

  search(query: FU.Query, { limit = -1 }: FU.SearchOptions = {}): FU.FuseResult[] {
    const {
      includeMatches,
      includeScore,
      shouldSort,
      sortFn,
      ignoreFieldNorm
    } = this.options;

    let results = isString(query)
      ? isString(this._docs[0])
        ? this._searchStringList(query)
        : this._searchObjectList(query)
      : this._searchLogical(query);

    computeScore(results, { ignoreFieldNorm });

    if (shouldSort) {
      results.sort(sortFn);
    }

    if (isNumber(limit) && limit > -1) {
      results = results.slice(0, limit);
    }

    return format(results, this._docs, {
      includeMatches,
      includeScore
    })
  }

  _searchStringList(query: string): FU.InternalResult[] {
    const searcher = createSearcher(query, this.options);
    const { records } = this._myIndex;
    const results: FU.InternalResult[] = [];

    // Iterate over every string in the index
    records.forEach(({ v: text, i: idx, n: norm }: FU.IndexRecord) => {
      if (!isDefined(text)) {
        return
      }

      const { isMatch, score, indices } = searcher.searchIn(text);

      if (isMatch) {
        results.push({
          item: text,
          idx,
          matches: [{ score, value: text, norm, indices }]
        });
      }
    });

    return results
  }

  _searchLogical(query: FU.Expression): FU.InternalResult[] {

    const expression = parse(query, this.options);

    const evaluate = (node: FU.QueryNode, item: FU.RecordEntries, idx: FU.DocIndex): FU.InternalResult[] => {
      if (!node.children) {
        const { keyId, searcher } = node;

        const matches = this._findMatches({
          key: this._keyStore.get(keyId!),
          value: this._myIndex.getValueForItemAtKeyId(item, keyId!),
          searcher: searcher!
        });

        if (matches && matches.length) {
          return [
            {
              idx,
              item,
              matches
            }
          ]
        }

        return []
      }

      const res: FU.InternalResult[] = [];
      for (let i = 0, len = node.children.length; i < len; i += 1) {
        const child = node.children[i];
        const result = evaluate(child, item, idx);
        if (result.length) {
          res.push(...result);
        } else if (node.operator === LogicalOperator.AND) {
          return []
        }
      }
      return res
    };

    const records = this._myIndex.records;
    const resultMap: FU.ResultMap = {};
    const results: FU.InternalResult[] = [];

    records.forEach(({ $: item, i: idx }: FU.IndexRecord) => {
      if (isDefined(item)) {
        let expResults = evaluate(expression, item, idx);

        if (expResults.length) {
          // Dedupe when adding
          if (!resultMap[idx]) {
            resultMap[idx] = { idx, item, matches: [] };
            results.push(resultMap[idx]);
          }
          expResults.forEach(({ matches }: FU.InternalResult) => {
            resultMap[idx].matches.push(...matches);
          });
        }
      }
    });

    return results
  }

  _searchObjectList(query: string): FU.InternalResult[] {
    const searcher = createSearcher(query, this.options);
    const { keys, records } = this._myIndex;
    const results: FU.InternalResult[] = [];

    // List is Array<Object>
    records.forEach(({ $: item, i: idx }: FU.IndexRecord) => {
      if (!isDefined(item)) {
        return
      }

      let matches: FU.Match[] = [];

      // Iterate over every key (i.e, path), and fetch the value at that key
      keys.forEach((key: FU.IndexKey, keyIndex: FU.KeyIndex) => {
        matches.push(
          ...this._findMatches({
            key,
            value: item[keyIndex],
            searcher
          })
        );
      });

      if (matches.length) {
        results.push({
          idx,
          item,
          matches
        });
      }
    });

    return results
  }
  _findMatches({ key, value, searcher }: FU.FindMatchesArgs): FU.Match[] {
    if (!isDefined(value)) {
      return []
    }

    let matches: FU.Match[] = [];

    if (isArray(value)) {
      value.forEach(({ v: text, i: idx, n: norm }: FU.ArrayEntry) => {
        if (!isDefined(text)) {
          return
        }

        const { isMatch, score, indices } = searcher.searchIn(text);

        if (isMatch) {
          matches.push({
            score,
            key,
            value: text,
            idx,
            norm,
            indices
          });
        }
      });
    } else {
      const { v: text, n: norm } = value;

      const { isMatch, score, indices } = searcher.searchIn(text);

      if (isMatch) {
        matches.push({ score, key, value: text, norm, indices });
      }
    }

    return matches
  }
}

Fuse.version = '7.0.0';
Fuse.createIndex = createIndex;
Fuse.parseIndex = parseIndex;
Fuse.config = Config;

{
  Fuse.parseQuery = parse;
}

{
  register(ExtendedSearch);
}

export { Fuse as default };
namespace FU {
  export type OnlyGiven<T> = 0 extends 1 & T ? T : never;
}
namespace FU {
  export type int32 = import("bun").int32;
  export type DocIndex = int32;
  export type ItemIndex = int32;
  export type KeyIndex = int32;
  export type TextIndex = int32;
  export type CharMask = int32;
  export type Bit = int32;
  export type ErrorCount = int32;
  export type TokenCount = int32;
  export type Score = number;
  export type FieldNorm = number;
  export type Weight = number;
  export type UserNumber = number;
  export type BitRow = number[];
  export type Given = any;
  export type Doc = any;
  export type Docs = any;
  export type Options = any;
  export type GivenIndexOptions = any;
  export type SearchOptions = any;
  export type ParseOptions = any;
  export type Flag = any;
  export type KeyDef = any;
  export type KeyDefs = any;
  export type GetFn = any;
  export type KeyGetFn = any;
  export type Sortable = any;
  export type IndexKey = any;
  export type IndexKeys = any;
  export type SortFn = any;
  export type Predicate = any;
  export type FieldValue = any;
  export type Query = any;
  export type Expression = any;
  export type GivenIndexData = any;
  export type GivenIndex = any;
  export type MatcherClass = any;
  export type KeySrc = string | string[];
  export type RangeTuple = [start: TextIndex, end: TextIndex];
  export type Indices = RangeTuple[] | RangeTuple;
  export type KeyMap = { [id: string]: Key };
  export type KeysMap = { [id: string]: KeyIndex };
  export type Alphabet = { [char: string]: CharMask };
  export type RecordEntries = { [keyIndex: number]: RecordEntry | ArrayEntry[] };
  export type ResultMap = { [idx: number]: InternalResult };
  export type Transformer = (result: InternalResult, data: FuseResult) => void;
  export interface Key { path: string[]; id: string; weight: Weight; src: KeySrc; getFn?: KeyGetFn }
  export interface MatchOptions { includeMatches: Flag; findAllMatches: Flag; minMatchCharLength: UserNumber }
  export interface BasicOptions { isCaseSensitive: Flag; includeScore: Flag; keys: KeyDefs; shouldSort: Flag; sortFn: SortFn }
  export interface FuzzyOptions { location: UserNumber; threshold: UserNumber; distance: UserNumber }
  export interface AdvancedOptions { useExtendedSearch: Flag; getFn: GetFn; ignoreLocation: Flag; ignoreFieldNorm: Flag; fieldNormWeight: UserNumber }
  export interface Config {
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
  export interface Norm { get: (value: string) => FieldNorm; clear: () => void }
  export interface IndexRecord { v?: string; i: DocIndex; n?: FieldNorm; $?: RecordEntries }
  export interface ArrayEntry { v: string; i: ItemIndex; n?: FieldNorm }
  export interface RecordEntry { v: string; n?: FieldNorm }
  export interface StackItem { nestedArrIndex: ItemIndex; value: FieldValue }
  export interface IndexJSON { keys: IndexKeys; records: IndexRecord[] }
  export interface IndexOptions { getFn?: GetFn; fieldNormWeight?: UserNumber }
  export interface ScoreParams { errors?: ErrorCount; currentLocation?: number; expectedLocation?: number; distance?: UserNumber; ignoreLocation?: Flag }
  export interface SearchResult { isMatch: boolean; score: Score; indices?: Indices }
  export interface BitapOptions { location: UserNumber; threshold: UserNumber; distance: UserNumber; includeMatches: Flag; findAllMatches: Flag; minMatchCharLength: UserNumber; isCaseSensitive: Flag; ignoreLocation: Flag }
  export interface Chunk { pattern: string; alphabet: Alphabet; startIndex: TextIndex }
  export interface BitapParams { location?: number; distance?: UserNumber; threshold?: UserNumber; findAllMatches?: Flag; minMatchCharLength?: UserNumber; includeMatches?: Flag; ignoreLocation?: Flag }
  export interface ExtendedOptions { isCaseSensitive: Flag; includeMatches: Flag; minMatchCharLength: UserNumber; findAllMatches: Flag; ignoreLocation: Flag; location: UserNumber; threshold: UserNumber; distance: UserNumber }
  export interface Searcher { searchIn(text: string): SearchResult }
  export interface Matcher { search(text: string): SearchResult }
  export interface LogicalOperators { AND: '$and'; OR: '$or' }
  export interface KeyTypes { PATH: '$path'; PATTERN: '$val' }
  export interface QueryNode { keyId?: string; pattern?: string; searcher?: Searcher; children?: QueryNode[]; operator?: string }
  export interface Match { score: Score; key?: IndexKey; value: string; idx?: ItemIndex; norm: FieldNorm | undefined; indices: Indices | undefined }
  export interface InternalResult { idx: DocIndex; item: string | RecordEntries; matches: Match[]; score?: Score }
  export interface FindMatchesArgs { key: IndexKey; value: RecordEntry | ArrayEntry[] | undefined; searcher: Searcher }
  export interface ResultMatch { indices: Indices; value: string; key?: KeySrc; refIndex?: ItemIndex }
  export interface FuseResult { item: Doc; refIndex: DocIndex; matches?: ResultMatch[]; score?: Score }
  export interface ScoreOptions { ignoreFieldNorm?: Flag }
  export interface FormatOptions { includeMatches?: Flag; includeScore?: Flag }
}
