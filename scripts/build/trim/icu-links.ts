import { zstdDecompressSync } from "node:zlib";
import { BuildError } from "../error.ts";
import { languageOfIcuItem } from "./icu-locales.ts";

export interface StoredIcuItem {
  name: string;
  bytes: Buffer;
}

/**
 * ICU opens `to` in the place of `from` (`%%ALIAS`), for what `from` lacks (`%%Parent`), or by a name that a string of
 * `from` has (`%%DEPENDENCY`). Both are items of one tree.
 */
export interface IcuLink {
  from: string;
  to: string;
  key: "%%ALIAS" | "%%Parent" | "%%DEPENDENCY";
}

// The format of a resource bundle: https://github.com/unicode-org/icu/blob/release-79.1/icu4c/source/common/uresdata.h#L158-L390
// The names are that file's. ICU reads a bundle with res_init, res_getTableItemByIndex and res_getStringNoTrace (uresdata.cpp).
const URES_TABLE = 2;
const URES_ALIAS = 3;
const URES_TABLE32 = 4;
const URES_TABLE16 = 5;
const URES_STRING_V2 = 6;
const URES_ARRAY = 8;
const URES_ARRAY16 = 9;
const URES_INDEX_KEYS_TOP = 1;
const URES_INDEX_BUNDLE_TOP = 3;
const URES_INDEX_MAX_TABLE_LENGTH = 4;
const URES_INDEX_ATTRIBUTES = 5;
const URES_INDEX_16BIT_TOP = 6;
const URES_INDEX_POOL_CHECKSUM = 7;
const URES_ATT_IS_POOL_BUNDLE = 2;
const URES_ATT_USES_POOL_BUNDLE = 4;
// oven-sh/WebKit icu/compress-data.ts stores an item as one zstd frame. An item as ICU wrote it has `da 27` in that word.
const zstdMagic = 0xfd2fb528;

interface Bundle {
  /** From the root resource to the top of the bundle. Every offset of the format counts from its start. */
  data: Buffer;
  rootResource: number;
  firstKey: number;
  /** A 16-bit key offset below it is a key of this bundle. One from it on is a key of the pool bundle. */
  localKeyLimit: number;
  keys: Buffer;
  units: Buffer;
  poolStringLimit: number;
  poolString16Limit: number;
  poolChecksum: number;
  isPool: boolean;
  usesPool: boolean;
}

class UnknownBundle extends Error {}

const unknown = (what: string): never => {
  throw new UnknownBundle(what);
};

/** The length of the zstd frame that `stored` starts with (RFC 8878, 3.1.1). What follows it aligns the next item. */
function frameLengthOf(stored: Buffer): number {
  const descriptor = stored[4]!;
  const isSingleSegment = (descriptor & 0x20) !== 0;
  const contentSizeLength = descriptor >> 6 === 0 ? Number(isSingleSegment) : 1 << (descriptor >> 6);
  let at = 5 + Number(!isSingleSegment) + [0, 1, 2, 4][descriptor & 3]! + contentSizeLength;
  for (let isLast = false; !isLast;) {
    const block = stored.readUIntLE(at, 3);
    isLast = (block & 1) !== 0;
    // A block of one repeated byte stores that byte. Another block stores as many bytes as its header says.
    at += 3 + (((block >> 1) & 3) === 1 ? 1 : block >> 3);
  }
  return at + ((descriptor & 4) !== 0 ? 4 : 0);
}

function decompress(stored: Buffer, dictionary: Buffer | undefined): Buffer {
  if (dictionary === undefined) return unknown("is a zstd frame, and the executable has no dictionary for it");
  try {
    // The decoder reads bytes behind a frame as the next frame when the frame's content fills its buffer exactly.
    return zstdDecompressSync(stored.subarray(0, frameLengthOf(stored)), { dictionary });
  } catch (cause) {
    return unknown(`is no zstd frame of the executable's dictionary (${(cause as Error).message})`);
  }
}

function openBundle(stored: Buffer, dictionary: Buffer | undefined): Bundle {
  const isFrame = stored.length >= 4 && stored.readUInt32LE(0) === zstdMagic;
  const bytes = isFrame ? decompress(stored, dictionary) : stored;
  // ucmndata.h MappedData, then udata.h UDataInfo: little-endian, ASCII, 16-bit characters, "ResB".
  const isBundle =
    bytes.length >= 24 &&
    bytes.readUInt16BE(2) === 0xda27 &&
    bytes.readUIntBE(8, 3) === 2 &&
    bytes.toString("latin1", 12, 16) === "ResB";
  if (!isBundle) unknown("is no resource bundle");
  const formatVersion = bytes[16]!;
  if (formatVersion !== 2 && formatVersion !== 3) unknown(`has format version ${formatVersion}`);
  const root = bytes.readUInt16LE(0);
  const indexLength = bytes.readInt32LE(root + 4) & 0xff;
  // An index that a bundle does not have is 0 to ICU (res_init).
  const indexAt = (index: number) => (index < indexLength ? bytes.readInt32LE(root + 4 * (1 + index)) : 0);
  const firstKey = 4 * (1 + indexLength);
  const keysTop = 4 * indexAt(URES_INDEX_KEYS_TOP);
  const unitsTop = 4 * indexAt(URES_INDEX_16BIT_TOP);
  const bundleTop = 4 * indexAt(URES_INDEX_BUNDLE_TOP);
  const isInOrder =
    firstKey <= keysTop && keysTop <= bundleTop && unitsTop <= bundleTop && root + bundleTop <= bytes.length;
  if (indexLength <= URES_INDEX_MAX_TABLE_LENGTH || !isInOrder) unknown("has indexes that are too few or not in order");
  const data = bytes.subarray(root, root + bundleTop);
  const attributes = indexAt(URES_INDEX_ATTRIBUTES);
  const bundle: Bundle = {
    data,
    rootResource: data.readUInt32LE(0),
    firstKey,
    localKeyLimit: keysTop > firstKey ? keysTop : 0,
    keys: data.subarray(firstKey, keysTop),
    units: data.subarray(keysTop, Math.max(keysTop, unitsTop)),
    poolStringLimit: (formatVersion === 3 ? indexAt(0) >>> 8 : 0) | ((attributes & 0xf000) << 12),
    poolString16Limit: attributes >>> 16,
    poolChecksum: indexAt(URES_INDEX_POOL_CHECKSUM),
    isPool: (attributes & URES_ATT_IS_POOL_BUNDLE) !== 0,
    usesPool: (attributes & URES_ATT_USES_POOL_BUNDLE) !== 0,
  };
  if ((bundle.isPool || bundle.usesPool) && indexLength <= URES_INDEX_POOL_CHECKSUM)
    unknown("is or uses a pool bundle and has no checksum of it");
  return bundle;
}

const poolOr = (pool: Bundle | undefined) => pool ?? unknown("refers to a pool bundle and uses none");

function keyAt(keys: Buffer, offset: number): string {
  const end = offset < 0 || offset >= keys.length ? -1 : keys.indexOf(0, offset);
  return end < 0 ? unknown("has a key outside the key strings") : keys.toString("latin1", offset, end);
}

function key16Of({ localKeyLimit, keys, firstKey }: Bundle, pool: Bundle | undefined, offset: number): string {
  return offset < localKeyLimit ? keyAt(keys, offset - firstKey) : keyAt(poolOr(pool).keys, offset - localKeyLimit);
}

function stringV2At(units: Buffer, offset: number): string {
  const start = 2 * offset;
  const first = units.readUInt16LE(start);
  // genrb writes a length there for a string of more than 40 characters (MAX_IMPLICIT_STRING_LENGTH in reslist.h).
  if (first >= 0xdc00 && first <= 0xdfff) unknown("has a link of more than 40 characters");
  let end = start;
  while (units.readUInt16LE(end) !== 0) end += 2;
  return units.toString("utf16le", start, end);
}

/** The string that a table or an array of 16-bit units has as `value`, as a resource. */
function string16Of({ poolStringLimit, poolString16Limit }: Bundle, value: number): number {
  const string = value < poolString16Limit ? value : value - poolString16Limit + poolStringLimit;
  return ((URES_STRING_V2 << 28) | string) >>> 0;
}

function entriesOf(bundle: Bundle, pool: Bundle | undefined, table: number): [key: string, value: number][] {
  const { data, units } = bundle;
  const offset = table & 0x0fffffff;
  const entries: [string, number][] = [];
  switch (table >>> 28) {
    case URES_TABLE: {
      const count = offset === 0 ? 0 : data.readUInt16LE(4 * offset);
      const keys = 4 * offset + 2;
      const values = keys + 2 * (count + (~count & 1));
      for (let i = 0; i < count; i++)
        entries.push([key16Of(bundle, pool, data.readUInt16LE(keys + 2 * i)), data.readUInt32LE(values + 4 * i)]);
      return entries;
    }
    case URES_TABLE16: {
      const count = units.readUInt16LE(2 * offset);
      const keys = 2 * offset + 2;
      for (let i = 0; i < count; i++) {
        const key = key16Of(bundle, pool, units.readUInt16LE(keys + 2 * i));
        entries.push([key, string16Of(bundle, units.readUInt16LE(keys + 2 * (count + i)))]);
      }
      return entries;
    }
    default:
      return unknown(`has the resource ${table.toString(16)} for a table of 16-bit keys`);
  }
}

function elementsOf(bundle: Bundle, array: number): number[] {
  const { data, units } = bundle;
  const offset = array & 0x0fffffff;
  switch (array >>> 28) {
    case URES_ARRAY: {
      const count = offset === 0 ? 0 : data.readInt32LE(4 * offset);
      return Array.from({ length: count }, (_, i) => data.readUInt32LE(4 * offset + 4 + 4 * i));
    }
    case URES_ARRAY16: {
      const count = units.readUInt16LE(2 * offset);
      return Array.from({ length: count }, (_, i) => string16Of(bundle, units.readUInt16LE(2 * offset + 2 + 2 * i)));
    }
    default:
      return unknown(`has the resource ${array.toString(16)} for an array`);
  }
}

function stringOf({ units, poolStringLimit }: Bundle, pool: Bundle | undefined, resource: number): string {
  const offset = resource & 0x0fffffff;
  if (resource >>> 28 !== URES_STRING_V2)
    unknown(`has the resource ${resource.toString(16)} for a string of 16-bit units`);
  return offset < poolStringLimit
    ? stringV2At(poolOr(pool).units, offset)
    : stringV2At(units, offset - poolStringLimit);
}

/**
 * A resource that is an alias takes ICU to another resource when a program reads it (getAliasTargetAsResourceBundle in
 * uresbund.cpp). `/LOCALE/...` stays in the locale that the program asked for. Every other alias names a bundle, and no
 * locale's bundle of ICU 79 has one. Only a table or an array of 32-bit resources can have an alias.
 */
function refuseAliasesToOtherBundles({ data, rootResource }: Bundle): void {
  const seen = new Set<number>();
  const pending = [rootResource];
  for (let resource = pending.pop(); resource !== undefined; resource = pending.pop()) {
    const type = resource >>> 28;
    const at = 4 * (resource & 0x0fffffff);
    if (type === URES_ALIAS) {
      const path = at === 0 ? "" : data.toString("utf16le", at + 4, at + 4 + 2 * data.readInt32LE(at));
      if (!path.startsWith("/LOCALE/")) unknown(`has the alias "${path}" to a resource of another bundle`);
    }
    if (type === URES_TABLE32) unknown("has a table of 32-bit keys");
    if ((type !== URES_TABLE && type !== URES_ARRAY) || at === 0 || seen.has(resource)) continue;
    seen.add(resource);
    const count = type === URES_TABLE ? data.readUInt16LE(at) : data.readInt32LE(at);
    const values = type === URES_TABLE ? at + 2 + 2 * (count + (~count & 1)) : at + 4;
    for (let i = 0; i < count; i++) pending.push(data.readUInt32LE(values + 4 * i));
  }
}

const treeOf = (name: string) => name.slice(0, name.indexOf("/") + 1);

/**
 * The items that ICU goes to from a locale's resource bundle: what ICU's own icupkg reads from a bundle for the same
 * question (ures_enumDependencies in tools/toolutil/pkgitems.cpp). A bundle of another shape, another key of ICU's own at
 * its top, or an alias to a resource of another bundle throws: a link that is not read is data that `--trim-locales`
 * removes from under a bundle it keeps. Not read: the parent that a name has by its own parts (`de_AT` has `de`, the same
 * language), the parents that ICU has compiled in (localefallback_data.h), and the locale in which ICU opens the rules of
 * a numbering system (`numberingSystems.res` has `zh/SpelloutRules` for `hanidays`, which the Chinese calendar of `yue`
 * names too).
 */
export function icuLinksOf(items: StoredIcuItem[], dictionary: Buffer | undefined): IcuLink[] {
  const stored = new Map(items.map(({ name, bytes }) => [name, bytes]));
  const fail = (name: string, what: string, cause?: unknown): never => {
    throw new BuildError(`ICU's ${name} ${what}`, {
      hint: "scripts/build/trim/icu-links.ts reads resource bundles as uresdata.h of ICU 79 describes them",
      cause,
    });
  };
  const read = <T>(name: string, body: (bundle: Bundle) => T): T => {
    try {
      return body(openBundle(stored.get(name)!, dictionary));
    } catch (cause) {
      if (cause instanceof UnknownBundle) return fail(name, cause.message);
      if (cause instanceof RangeError) return fail(name, "has an offset outside the bundle", cause);
      throw cause;
    }
  };
  const pools = new Map<string, Bundle>();
  const poolOf = (tree: string, user: Bundle): Bundle | undefined => {
    if (!user.usesPool) return undefined;
    const name = `${tree}pool.res`;
    if (!stored.has(name)) unknown(`uses a pool bundle, and there is no ${name}`);
    const pool = pools.get(tree) ?? read(name, opened => opened);
    pools.set(tree, pool);
    if (!pool.isPool || pool.poolChecksum !== user.poolChecksum) unknown(`uses another pool bundle than ${name}`);
    return pool;
  };

  const links: IcuLink[] = [];
  const aliases = new Set<string>();
  for (const { name } of items) {
    if (languageOfIcuItem(name) === undefined) continue;
    const tree = treeOf(name);
    read(name, bundle => {
      const pool = poolOf(tree, bundle);
      const link = (key: IcuLink["key"], to: string) => {
        if (!stored.has(to)) unknown(`has the ${key} ${to}, which is no item`);
        links.push({ from: name, to, key });
      };
      for (const [key, value] of entriesOf(bundle, pool, bundle.rootResource)) {
        if (key === "%%ALIAS" || key === "%%Parent") {
          link(key, `${tree}${stringOf(bundle, pool, value)}.res`);
          if (key === "%%ALIAS") aliases.add(name);
        } else if (key === "%%DEPENDENCY") {
          // genrb lists there each file that a string of the bundle names, such as the rules of a break iterator.
          for (const file of elementsOf(bundle, value)) link(key, `${tree}${stringOf(bundle, pool, file)}`);
        } else if (key.startsWith("%%") && key !== "%%ParentIsRoot") {
          // %%ParentIsRoot only ends the parents of the bundle at root.res.
          unknown(`has the key ${key}`);
        }
      }
      refuseAliasesToOtherBundles(bundle);
    });
  }

  // ICU lists the aliases of each tree itself, in a bundle without a pool. So the list is a second reading of the same fact.
  for (const { name } of items) {
    const tree = treeOf(name);
    if (name !== `${tree}res_index.res`) continue;
    const listed = read(name, index => {
      const pool = poolOf(tree, index);
      const table = entriesOf(index, pool, index.rootResource).find(([key]) => key === "AliasLocales");
      const locales = table === undefined ? [] : entriesOf(index, pool, table[1]);
      return new Set(locales.map(([locale]) => `${tree}${locale}.res`).filter(item => stored.has(item)));
    });
    const found = [...aliases].filter(alias => treeOf(alias) === tree);
    const differing = [...found.filter(alias => !listed.has(alias)), ...[...listed].filter(item => !aliases.has(item))];
    if (differing.length > 0)
      fail(name, `lists other aliases than the bundles with an %%ALIAS: ${differing.sort().join(", ")}`);
  }
  return links;
}
