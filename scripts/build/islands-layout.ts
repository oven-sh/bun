import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const pageSize = 16384;
const mostStretches = 2048;
const mostHoles = 48;

export interface Layout {
  address: number[];
  size: number[];
  alignment: number[];
  output: string[];
}

export interface Needs {
  core: Set<number>;
  neededBy: Map<number, string>;
}

export interface Plan {
  doors: string[];
  first?: string[];
  islands: { features: string; names: string[]; behindWhatStays?: string[] }[];
  tableBytes?: number;
}

const planHeader = "bun-islands-plan 1";

export function isPlan(path: string | undefined): boolean {
  return path !== undefined && existsSync(path) && readFileSync(path, "latin1").startsWith(planHeader + "\n");
}

export function readPlan(path: string | undefined, features: string[], doors: string): Plan | undefined {
  if (path === undefined || !existsSync(path)) return undefined;
  const lines = readFileSync(path, "latin1").split("\n");
  if (lines[0] !== planHeader || lines[1] !== "for " + doors) return undefined;
  const known = new Set(features);
  const plan: Plan = { doors: [], islands: [] };
  for (const line of lines.slice(2)) {
    if (line.startsWith("island ")) plan.islands.push({ features: line.slice(7), names: [] });
    else if (line.startsWith("door ")) plan.doors.push(line.slice(5));
    else if (line.startsWith("table ")) plan.tableBytes = Number(line.slice(6));
    else if (line.startsWith("first ")) (plan.first ??= []).push(line.slice(6));
    else if (line.startsWith("behind ")) (plan.islands.at(-1)!.behindWhatStays ??= []).push(line.slice(7));
    else if (line !== "") plan.islands.at(-1)?.names.push(line);
  }
  plan.islands = plan.islands.filter(island => island.features.split(",").every(feature => known.has(feature)));
  return plan.islands.length > 0 ? plan : undefined;
}

export function writePlan(path: string, plan: Plan, doors: string): void {
  const lines = [
    planHeader,
    "for " + doors,
    ...(plan.tableBytes === undefined ? [] : ["table " + plan.tableBytes]),
    ...plan.doors.map(name => "door " + name),
    ...(plan.first ?? []).map(name => "first " + name),
    ...plan.islands.flatMap(island => ["island " + island.features, ...island.names, ...(island.behindWhatStays ?? []).map(name => "behind " + name)]),
  ];
  writeFileSync(path, lines.join("\n") + "\n", "latin1");
}

export interface Range {
  start: number;
  end: number;
  features: string;
}

export function rangesThatCanGo(graph: Layout, analysis: Needs, isMovable: (output: string) => boolean): Range[] {
  const runs: Range[][] = [];
  let run: Range[] = [];
  const length = (run: Range[]) => run.at(-1)!.end - run[0]!.start;
  const close = () => {
    if (run.length > 0 && length(run) >= pageSize) runs.push(run);
    run = [];
  };
  for (let node = 0; node < graph.address.length; node++) {
    const features = isMovable(graph.output[node]!) && !analysis.core.has(node) ? analysis.neededBy.get(node) : undefined;
    if (features === undefined) {
      close();
      continue;
    }
    const start = graph.address[node]!;
    const isNextToTheLast = node > 0 && graph.output[node - 1] === graph.output[node] && start - (graph.address[node - 1]! + graph.size[node - 1]!) < graph.alignment[node]!;
    if (!isNextToTheLast) close();
    const last = run.at(-1);
    if (last?.features === features) last.end = start + graph.size[node]!;
    else {
      if (last !== undefined) last.end = start;
      run.push({ start, end: start + graph.size[node]!, features });
    }
  }
  close();
  const kept: Range[][] = [];
  let stretches = 0;
  for (const run of runs.sort((a, b) => length(b) - length(a))) {
    if ((stretches += run.length) > mostStretches) break;
    kept.push(run);
  }
  return kept.flat().sort((a, b) => a.start - b.start);
}

export function misplaced(graph: Layout, analysis: Needs, ranges: Range[]): number {
  let faults = 0;
  let at = 0;
  for (let node = 0; node < graph.address.length; node++) {
    const start = graph.address[node]!;
    while (at < ranges.length && ranges[at]!.end <= start) at++;
    const range = ranges[at];
    if (range === undefined || start + graph.size[node]! <= range.start) continue;
    if (analysis.core.has(node) || analysis.neededBy.get(node) !== range.features) faults++;
  }
  return faults;
}

export function wholePages(ranges: Range[]): number {
  const holes: number[] = [];
  let start = -1;
  let end = -1;
  const close = () => void holes.push(Math.max(0, Math.floor(end / pageSize) * pageSize - Math.ceil(start / pageSize) * pageSize));
  for (const range of ranges) {
    if (range.start === end) end = range.end;
    else {
      close();
      ({ start, end } = range);
    }
  }
  close();
  return holes
    .sort((a, b) => b - a)
    .slice(0, mostHoles)
    .reduce((sum, bytes) => sum + bytes, 0);
}

export const roomFor = (tableBytes: number) => Math.ceil((tableBytes * 17) / 16 / 1024) * 1024;
const tableHeader = "bun-islands 2\n";

export const placeKinds = { add32: 0, add64: 1, branch26: 2, page21: 3, low12: 4, adr: 5, pointer36: 6, nop: 7 } as const;

const isPlaceKind = (kind: number) => Object.values<number>(placeKinds).includes(kind);

export interface Place {
  address: number;
  kind: number;
}

export function groupsOfPlaces(places: Place[]): Place[][] | undefined {
  const groups: Place[][] = [];
  for (let index = 0; index < places.length; index += groups.at(-1)!.length) {
    const kind = places[index]!.kind;
    const other = kind === placeKinds.adr ? placeKinds.nop : kind === placeKinds.nop ? placeKinds.adr : undefined;
    if (other !== undefined && places[index + 1]?.kind !== other) return undefined;
    groups.push(places.slice(index, index + (other === undefined ? 1 : 2)));
  }
  return groups;
}

export interface TableDoor {
  address: number;
  feature: string;
  whenShut: "exit" | "return";
  places?: Place[];
}

export interface ItemRun {
  first: number;
  count: number;
  features: string;
}

export interface DataPackage {
  start: number;
  end: number;
  runs: ItemRun[];
}

export interface Table {
  stub: number;
  smallestDoor: { exit: number; return: number };
  features: string[];
  conditions: { feature: string; kind: string; name: string }[];
  islands: Range[];
  doors: TableDoor[];
  packages?: DataPackage[];
}

const firstFeatureOf = (door: TableDoor) => door.feature.split(",", 1)[0]!;

export function inTableOrder<D extends TableDoor>(features: string[], doors: D[]): D[] {
  const rank = (door: D) => features.indexOf(firstFeatureOf(door)) * 2 + (door.whenShut === "exit" ? 0 : 1);
  return [...doors].sort((a, b) => rank(a) - rank(b) || a.address - b.address);
}

export function encodeTable(table: Table, room = Infinity): Buffer {
  const bytes: number[] = [...Buffer.from(tableHeader)];
  const number = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`the table cannot hold the number ${value}`);
    for (; value >= 128; value = Math.floor(value / 128)) bytes.push((value % 128) + 128);
    bytes.push(value);
  };
  const text = (value: string) => {
    const encoded = Buffer.from(value);
    number(encoded.length);
    bytes.push(...encoded);
  };
  const list = <T>(items: T[], write: (item: T) => void) => {
    number(items.length);
    items.forEach(write);
  };
  const indexIn = (items: string[], item: string) => {
    const index = items.indexOf(item);
    if (index < 0) throw new Error(`the table does not list ${item}`);
    number(index);
  };
  const ascending = (addresses: number[]) => {
    let last = 0;
    for (const address of addresses) {
      number(address - last);
      last = address;
    }
  };
  const distinct = (items: string[]) => [...new Set(items)];
  const spell = (fact: { kind: string; name: string }) => `${fact.kind} ${fact.name}`;
  const kinds = distinct(table.conditions.map(condition => condition.kind));
  const facts = distinct(table.conditions.map(spell));
  const packages = table.packages ?? [];
  const shared = table.doors.map((door, index) => ({ index, features: door.feature })).filter(door => door.features.includes(","));
  const sets = distinct([...table.islands, ...packages.flatMap(dataPackage => dataPackage.runs), ...shared].map(({ features }) => features));
  for (const feature of [...table.conditions, ...table.doors].flatMap(({ feature }) => feature.split(","))) {
    if (!table.features.includes(feature)) throw new Error(`the table does not list ${feature}`);
  }
  const isInDeclaredOrder = (set: string) => set.split(",").every((feature, index, all) => index === 0 || table.features.indexOf(all[index - 1]!) < table.features.indexOf(feature));
  if (!shared.every(door => isInDeclaredOrder(door.features))) throw new Error("the features of a door are not in the order in which they are declared");
  if (inTableOrder(table.features, table.doors).some((door, index) => door !== table.doors[index])) throw new Error("the doors are not in the order of the table");

  number(table.stub);
  number(table.smallestDoor.exit);
  number(table.smallestDoor.return);
  list(table.features, text);
  list(kinds, text);
  list(facts, fact => {
    const kind = fact.slice(0, fact.indexOf(" "));
    indexIn(kinds, kind);
    text(fact.slice(kind.length + 1));
  });
  for (const feature of table.features) {
    list(
      table.conditions.filter(condition => condition.feature === feature),
      condition => indexIn(facts, spell(condition)),
    );
  }
  list(sets, set => list(set.split(","), feature => indexIn(table.features, feature)));
  number(table.islands.length);
  let end = 0;
  for (const island of table.islands) {
    number(island.start - end);
    number(island.end - island.start - 1);
    indexIn(sets, island.features);
    end = island.end;
  }
  for (const feature of table.features) {
    for (const whenShut of ["exit", "return"]) {
      const doors = table.doors.filter(door => firstFeatureOf(door) === feature && door.whenShut === whenShut);
      number(doors.length);
      ascending(doors.map(door => door.address));
    }
  }
  const thin = table.doors.map((door, index) => ({ index, places: door.places ?? [] })).filter(door => door.places.length > 0);
  const unit = thin.every(door => door.places.every(place => place.address % 4 === 0)) ? 4 : 1;
  let next = 0;
  let lastFirst = 0;
  number(thin.length);
  if (thin.length > 0) number(unit);
  for (const { index, places } of thin) {
    number((index - next) * 4 + Math.min(places.length - 1, 3));
    if (places.length > 3) number(places.length - 4);
    if (groupsOfPlaces(places) === undefined) throw new Error("an adr has no nop beside it");
    let last = -1;
    for (const { address, kind } of places) {
      if (!isPlaceKind(kind)) throw new Error(`the table knows no place of the kind ${kind}`);
      if (address <= last) throw new Error("the places of a door are not in ascending order");
      const gap = (address - (last < 0 ? lastFirst : last)) / unit;
      number((last >= 0 ? gap : gap >= 0 ? gap * 2 : -gap * 2 - 1) * 8 + kind);
      last = address;
    }
    lastFirst = places[0]!.address;
    next = index + 1;
  }
  if (packages.length > 0 || shared.length > 0) {
    list(packages, ({ start, end, runs }) => {
      number(start);
      number(end - start);
      let next = 0;
      list(runs, ({ first, count, features }) => {
        number(first - next);
        number(count - 1);
        indexIn(sets, features);
        next = first + count;
      });
    });
  }
  if (shared.length > 0) {
    let next = 0;
    list(shared, ({ index, features }) => {
      number(index - next);
      indexIn(sets, features);
      next = index + 1;
    });
  }
  if (bytes.length > room) throw new Error(`the table takes ${bytes.length} bytes and there is room for ${room}`);
  return Buffer.from(bytes);
}

export function decodeTable(bytes: Uint8Array): Table {
  const malformed = (): never => {
    throw new Error("the table is malformed");
  };
  let at = tableHeader.length;
  if (Buffer.from(bytes.subarray(0, at)).toString("latin1") !== tableHeader) throw new Error("there is no table");
  const number = () => {
    let value = 0;
    for (let scale = 1; ; scale *= 128) {
      const byte = bytes[at++] ?? malformed();
      value += (byte % 128) * scale;
      if (!Number.isSafeInteger(value) || (byte === 0 && scale > 1)) malformed();
      if (byte < 128) return value;
    }
  };
  const text = () => {
    const length = number();
    if (length > bytes.length - at) malformed();
    return Buffer.from(bytes.subarray(at, (at += length))).toString();
  };
  const list = <T>(read: () => T) => {
    const length = number();
    if (length > bytes.length - at) malformed();
    return Array.from({ length }, read);
  };
  const oneOf = <T>(items: T[]) => items[number()] ?? malformed();
  const sum = (a: number, b: number) => (Number.isSafeInteger(a + b) ? a + b : malformed());

  const stub = number();
  const smallestDoor = { exit: number(), return: number() };
  const features = list(text);
  const kinds = list(text);
  const facts = list(() => ({ kind: oneOf(kinds), name: text() }));
  const conditions = features.flatMap(feature => list(() => ({ feature, ...oneOf(facts) })));
  const sets = list(() => {
    const members = list(() => oneOf(features));
    return members.length > 0 ? members.join(",") : malformed();
  });
  let end = 0;
  const islands = list(() => {
    const start = sum(end, number());
    end = sum(sum(start, number()), 1);
    return { start, end, features: oneOf(sets) };
  });
  const doors = features.flatMap(feature =>
    (["exit", "return"] as const).flatMap(whenShut => {
      let address = 0;
      return list((): TableDoor => ({ address: (address = sum(address, number())), feature, whenShut }));
    }),
  );
  let next = 0;
  let lastFirst = 0;
  let unit = 0;
  list(() => {
    unit ||= number();
    if (unit !== 1 && unit !== 4) malformed();
    const head = number();
    const index = sum(next, Math.floor(head / 4));
    const door = doors[index] ?? malformed();
    const length = head % 4 < 3 ? (head % 4) + 1 : sum(number(), 4);
    if (length > bytes.length - at) malformed();
    let address = lastFirst;
    door.places = Array.from({ length }, (_, place) => {
      const field = number();
      const gap = Math.floor(field / 8);
      if ((place > 0 && gap === 0) || !isPlaceKind(field % 8)) malformed();
      address = sum(address, (place > 0 ? gap : gap % 2 === 0 ? gap / 2 : -(gap + 1) / 2) * unit);
      return { address: address >= 0 ? address : malformed(), kind: field % 8 };
    });
    if (groupsOfPlaces(door.places) === undefined) malformed();
    lastFirst = door.places[0]!.address;
    next = index + 1;
  });
  const packages = at === bytes.length ? [] : list(() => {
    const start = number();
    const end = sum(start, number());
    let next = 0;
    const runs = list(() => {
      const first = sum(next, number());
      const count = sum(number(), 1);
      next = sum(first, count);
      return { first, count, features: oneOf(sets) };
    });
    return { start, end, runs };
  });
  let nextShared = 0;
  if (at < bytes.length) {
    list(() => {
      const index = sum(nextShared, number());
      const door = doors[index] ?? malformed();
      const set = oneOf(sets);
      const members = set.split(",").map(feature => features.indexOf(feature));
      if (!set.startsWith(door.feature + ",") || members.some((member, at) => at > 0 && members[at - 1]! >= member)) malformed();
      door.feature = set;
      nextShared = index + 1;
    });
  }
  if (bytes.subarray(at).some(byte => byte !== 0)) malformed();
  return { stub, smallestDoor, features, conditions, islands, doors, ...(packages.length > 0 ? { packages } : {}) };
}

export interface Item {
  name: string;
  size: number;
}

export interface Claim {
  feature: string;
  pattern: RegExp;
}

export function itemsOf(dataPackage: Buffer): Item[] {
  const malformed = (): never => {
    throw new Error("ICU's data package is malformed");
  };
  const isCommonData = dataPackage.length >= 32 && dataPackage.readUInt16BE(2) === 0xda27 && dataPackage[8] === 0 && dataPackage.toString("latin1", 12, 17) === "CmnD\x01";
  if (!isCommonData) malformed();
  const contents = dataPackage.subarray(dataPackage.readUInt16LE(0));
  const count = contents.length >= 4 ? contents.readUInt32LE(0) : malformed();
  if (4 + count * 8 > contents.length) malformed();
  const startOf = (index: number) => (index < count ? contents.readUInt32LE(8 + index * 8) : contents.length);
  return Array.from({ length: count }, (_, index) => {
    const name = contents.readUInt32LE(4 + index * 8);
    const end = contents.indexOf(0, name);
    const size = startOf(index + 1) - startOf(index);
    if (end < 0 || size < 0 || startOf(index + 1) > contents.length) malformed();
    const path = contents.toString("latin1", name, end);
    return { name: path.slice(path.indexOf("/") + 1), size };
  });
}

export function runsOf(items: Item[], claims: Claim[], features: string[], kept: RegExp[] = []): ItemRun[] {
  const runs: ItemRun[] = [];
  items.forEach(({ name }, index) => {
    if (kept.some(pattern => pattern.test(name))) return;
    const claimedBy = new Set(claims.filter(claim => claim.pattern.test(name)).map(claim => claim.feature));
    if (claimedBy.size === 0) return;
    const set = features.filter(feature => claimedBy.has(feature)).join(",");
    const last = runs.at(-1);
    if (last !== undefined && last.features === set && last.first + last.count === index) last.count++;
    else runs.push({ first: index, count: 1, features: set });
  });
  return runs;
}

const secret = Buffer.from(
  "b8fe6c3923a44bbe7c01812cf721ad1cded46de9839097db7240a4a4b7b3671fcb79e64eccc0e578825ad07dccff7221b8084674f743248ee03590e6813a264c" +
    "3c2852bb91c300cb88d0658b1b532ea371644897a20df94e3819ef46a9deacd8a8fa763fe39c343ff9dcbbc7c70b4f1d8a51e04bcdb45931c89f7ec9d9787364" +
    "eac5ac8334d3ebc3c581a0fffa1363eb170ddd51b7f0da49d316552629d4689e2b16be587d47a1fc8ff8b8d17ad031ce45cb3a8f95160428afd7fbcabb4b407e",
  "hex",
);
const mask = (1n << 64n) - 1n;
const prime32a = 0x9e3779b1n;
const prime32b = 0x85ebca77n;
const prime32c = 0xc2b2ae3dn;
const prime64a = 0x9e3779b185ebca87n;
const prime64b = 0xc2b2ae3d27d4eb4fn;
const prime64c = 0x165667b19e3779f9n;
const prime64d = 0x85ebca77c2b2ae63n;
const prime64e = 0x27d4eb2f165667c5n;
const primeMixA = 0x165667919e3779f9n;
const primeMixB = 0x9fb21c651e98df25n;
const read64 = (bytes: Buffer, at: number) => bytes.readBigUInt64LE(at);
const read32 = (bytes: Buffer, at: number) => BigInt(bytes.readUInt32LE(at));
const rotate = (value: bigint, by: bigint) => ((value << by) | (value >> (64n - by))) & mask;
const swap64 = (value: bigint) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes.readBigUInt64BE(0);
};
const foldedProduct = (a: bigint, b: bigint) => {
  const product = a * b;
  return (product & mask) ^ (product >> 64n);
};
const avalanche = (hash: bigint) => {
  hash ^= hash >> 37n;
  hash = (hash * primeMixA) & mask;
  return hash ^ (hash >> 32n);
};
const avalanche64 = (hash: bigint) => {
  hash ^= hash >> 33n;
  hash = (hash * prime64b) & mask;
  hash ^= hash >> 29n;
  hash = (hash * prime64c) & mask;
  return hash ^ (hash >> 32n);
};
const mix16 = (bytes: Buffer, at: number, secretAt: number) => foldedProduct(read64(bytes, at) ^ read64(secret, secretAt), read64(bytes, at + 8) ^ read64(secret, secretAt + 8));

export function xxh3(bytes: Buffer): bigint {
  const length = bytes.length;
  const size = BigInt(length);
  if (length === 0) return avalanche64(read64(secret, 56) ^ read64(secret, 64));
  if (length <= 3) {
    const combined = (BigInt(bytes[0]!) << 16n) | (BigInt(bytes[length >> 1]!) << 24n) | BigInt(bytes[length - 1]!) | (size << 8n);
    return avalanche64((read32(secret, 0) ^ read32(secret, 4)) ^ combined);
  }
  if (length <= 8) {
    const keyed = (read32(bytes, length - 4) + (read32(bytes, 0) << 32n)) ^ (read64(secret, 8) ^ read64(secret, 16));
    let hash = keyed ^ rotate(keyed, 49n) ^ rotate(keyed, 24n);
    hash = (hash * primeMixB) & mask;
    hash ^= (hash >> 35n) + size;
    hash = (hash * primeMixB) & mask;
    return hash ^ (hash >> 28n);
  }
  if (length <= 16) {
    const low = read64(bytes, 0) ^ (read64(secret, 24) ^ read64(secret, 32));
    const high = read64(bytes, length - 8) ^ (read64(secret, 40) ^ read64(secret, 48));
    return avalanche((size + swap64(low) + high + foldedProduct(low, high)) & mask);
  }
  if (length <= 128) {
    let sum = (size * prime64a) & mask;
    for (let round = (length - 1) >> 5; round >= 0; round--) {
      sum += mix16(bytes, 16 * round, 32 * round) + mix16(bytes, length - 16 * (round + 1), 32 * round + 16);
    }
    return avalanche(sum & mask);
  }
  if (length <= 240) {
    let sum = (size * prime64a) & mask;
    for (let round = 0; round < 8; round++) sum += mix16(bytes, 16 * round, 16 * round);
    sum = avalanche(sum & mask);
    for (let round = 8; round < length >> 4; round++) sum += mix16(bytes, 16 * round, 16 * (round - 8) + 3);
    return avalanche((sum + mix16(bytes, length - 16, 136 - 17)) & mask);
  }
  const lanes = [prime32c, prime64a, prime64b, prime64c, prime64d, prime32b, prime64e, prime32a];
  const accumulate = (at: number, secretAt: number) => {
    for (let lane = 0; lane < 8; lane++) {
      const value = read64(bytes, at + 8 * lane);
      const keyed = value ^ read64(secret, secretAt + 8 * lane);
      lanes[lane ^ 1] = (lanes[lane ^ 1]! + value) & mask;
      lanes[lane] = (lanes[lane]! + (keyed & 0xffffffffn) * (keyed >> 32n)) & mask;
    }
  };
  const stripesInABlock = (secret.length - 64) / 8;
  const block = 64 * stripesInABlock;
  const blocks = Math.floor((length - 1) / block);
  for (let index = 0; index < blocks; index++) {
    for (let stripe = 0; stripe < stripesInABlock; stripe++) accumulate(index * block + stripe * 64, stripe * 8);
    for (let lane = 0; lane < 8; lane++) {
      let value = lanes[lane]!;
      value ^= value >> 47n;
      value ^= read64(secret, secret.length - 64 + 8 * lane);
      lanes[lane] = (value * prime32a) & mask;
    }
  }
  const stripes = Math.floor((length - 1 - block * blocks) / 64);
  for (let stripe = 0; stripe < stripes; stripe++) accumulate(blocks * block + stripe * 64, stripe * 8);
  accumulate(length - 64, secret.length - 64 - 7);
  let sum = (size * prime64a) & mask;
  for (let pair = 0; pair < 4; pair++) sum += foldedProduct(lanes[2 * pair]! ^ read64(secret, 11 + 16 * pair), lanes[2 * pair + 1]! ^ read64(secret, 11 + 16 * pair + 8));
  return avalanche(sum & mask);
}
