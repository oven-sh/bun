// Operands for a function about which nothing is declared: every combination of a few kinds of value, then every kind of real
// object where an object got furthest, then plain objects with the names that the function was seen to look for.
import { closeSync, mkdirSync, openSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import {
  contentOrigin,
  createCallback,
  everyCandidate,
  findCandidate,
  operandOrigin,
  type Candidate,
} from "../differential/instances";
import type { Log } from "../differential/log";
import type { OperandSet, Run } from "../differential/runs";
import type { OperandName } from "../differential/table-description";

export function createSet(receiver: Candidate, args: readonly Candidate[]): OperandSet {
  return {
    name: `${receiver.name}(${args.map(candidate => candidate.name).join(", ")})`,
    receiver,
    arguments: [...args],
    surplusCount: 0,
  };
}

function realObject(name: string, create: (log: Log, operand: OperandName) => object): Candidate {
  return {
    name,
    kind: "Customized",
    create(log, operand) {
      const value = create(log, operand);
      log.identify(value, operandOrigin(operand));
      return value;
    },
  };
}

// Names of what lies in the working folder of the test, made again for every call: an earlier call may have taken it away.
function pathCandidate(name: string, path: string, make: (path: string) => void): Candidate[] {
  const prepare = () => {
    rmSync(path, { force: true, recursive: true });
    make(path);
    return path;
  };
  return [
    { name: `path:${name}`, kind: "Primitive", create: prepare },
    realObject(`path:${name}:Buffer`, () => Buffer.from(prepare())),
  ];
}

const pathCandidates = [
  ...pathCandidate("file", "native-contract-file.txt", path => writeFileSync(path, "text")),
  ...pathCandidate("folder", "native-contract-folder", path => {
    mkdirSync(path);
    writeFileSync(`${path}/inside.txt`, "text");
  }),
  ...pathCandidate("emptyFolder", "native-contract-empty-folder", path => mkdirSync(path)),
  ...pathCandidate("link", "native-contract-link", path => {
    writeFileSync("native-contract-link-target.txt", "text");
    symlinkSync("native-contract-link-target.txt", path);
  }),
  ...pathCandidate("free", "native-contract-free-name", () => {}),
];
const noop = () => {};
const networkCandidates: Candidate[] = [
  { name: "address:loopback", kind: "Primitive", create: () => "127.0.0.1" },
  { name: "address:multicast", kind: "Primitive", create: () => "224.0.0.114" },
  { name: "port:discard", kind: "Primitive", create: () => 9 },
  { name: "text:label", kind: "Primitive", create: () => "label" },
  realObject("socket:handlers", () => ({ socket: { data: noop, open: noop, close: noop, error: noop, drain: noop } })),
];
const ownerCandidates: Candidate[] = [
  { name: "owner:user", kind: "Primitive", create: () => process.getuid!() },
  { name: "owner:group", kind: "Primitive", create: () => process.getgid!() },
];

class Point {
  x = 1;
  y = 2;
  #hidden = 3;
  get sum() {
    return this.x + this.y + this.#hidden;
  }
}

const scratchFile = "native-contract-descriptor.txt";
let openDescriptor: number | undefined;

// A number that names an open file of the test, where a small integer would name a file of the process.
export const descriptorCandidate: Candidate = {
  name: "descriptor",
  kind: "Primitive",
  create() {
    // An earlier call may have taken the file away or closed it to its owner.
    rmSync(scratchFile, { force: true, recursive: true });
    writeFileSync(scratchFile, "text");
    openDescriptor = openSync(scratchFile, "r+");
    return openDescriptor;
  },
  release() {
    try {
      if (openDescriptor !== undefined) closeSync(openDescriptor);
    } catch {}
    openDescriptor = undefined;
  },
};

const combinedKinds = [
  "object:proxy",
  "object:primitives",
  "numbers:Array",
  "callback:object",
  "filled:Buffer",
  'primitive:"a"',
  "primitive:1",
  "primitive:undefined",
].map(findCandidate);

export const realObjects: Candidate[] = [
  ...[
    "object:plain",
    "object:nullPrototype",
    "object:symbolKeys",
    "object:indexKeys",
    "object:ordinary",
    "object:accessors",
    "proxy:Array",
    "filled:Array",
    "empty:Array",
    "strings:Array",
    "doubles:Array",
    "mixed:Array",
    "holes:Array",
    "nested:Array",
    "stringPairs:Array",
    "ownProperty:Array",
    "subclass:Array",
    "arguments",
    "filled:Map",
    "primitives:Map",
    "filled:Set",
    "primitives:Set",
    "filled:WeakMap",
    "valid:Date",
    "filled:Error",
    "subclass:Error",
    "function:class",
    "function:arrow",
    "function:bound",
    "filled:Uint8Array",
    "filled:Int32Array",
    "filled:Uint32Array",
    "filled:Float64Array",
    "filled:BigInt64Array",
    "filled:ArrayBuffer",
    "resizable:ArrayBuffer",
    "filled:SharedArrayBuffer",
    "filled:DataView",
    "fulfilled:Promise",
    "pending:Promise",
    "global:RegExp",
    "boxed:String",
    "iterable:strings",
    "generator",
    "filled:Headers",
    "filled:Request",
    "filled:Response",
    "filled:URL",
    "filled:URLSearchParams",
    "filled:Blob",
    "filled:FormData",
    "filled:AbortSignal",
    "filled:ReadableStream",
    "filled:EventTarget",
  ].map(findCandidate),
  realObject("instance:class", () => new Point()),
  realObject("iterator:Map", () => new Map([[1, 2]]).entries()),
  realObject("iterator:Set", () => new Set([1]).values()),
  realObject("large:Array", () => Array.from({ length: 64 }, (_, index) => index)),
  realObject("large:Uint8Array", () => new Uint8Array(4096)),
  realObject("large:Buffer", () => Buffer.alloc(4096)),
  realObject("buffers:Array", () => [Buffer.alloc(8), new Uint8Array(8)]),
  realObject("objects:Array", () => [{ a: 1 }, { a: 2 }]),
];

export const otherReceivers = ["object:proxy", "object:primitives", "callback:object", "function:class", "primitive:undefined"].map(findCandidate);

const maxCombinedPositions = 3;

export function combinedSets(receiver: Candidate, argumentCount: number, usesDescriptors: boolean): OperandSet[] {
  const kinds = usesDescriptors
    ? combinedKinds.map(kind => (kind.name === "primitive:1" ? descriptorCandidate : kind))
    : combinedKinds;
  let vectors: Candidate[][] = [[]];
  for (let position = 0; position < Math.min(argumentCount, maxCombinedPositions); position++) {
    vectors = vectors.flatMap(vector => kinds.map(kind => [...vector, kind]));
  }
  const sets = vectors.map(vector => createSet(receiver, vector));
  if (argumentCount <= maxCombinedPositions) return sets;
  // Past the third position each kind is passed in every further position at once.
  const further = argumentCount - maxCombinedPositions;
  return vectors.flatMap(vector => kinds.map(kind => createSet(receiver, [...vector, ...Array<Candidate>(further).fill(kind)])));
}

export function setsWithRealObjects(base: OperandSet): OperandSet[] {
  return base.arguments.flatMap((_, position) =>
    realObjects.map(candidate => createSet(base.receiver, base.arguments.with(position, candidate))),
  );
}

export type NamesRead = Map<string, Set<string>>;

const namesOfProtocols = new Set(["then", "toString", "valueOf", "toJSON", "constructor", "length", "a", "b"]);
const readingTraps = new Set(["get", "has", "getOwnPropertyDescriptor"]);

// The names that were looked for in argument `position`, under "" for the argument itself and under a name for what that name held.
export function collectNamesRead({ log }: Run, position: number, names: NamesRead): void {
  for (const { trap, key, origin } of log.events) {
    if (!readingTraps.has(trap) || typeof key !== "string" || namesOfProtocols.has(key) || origin.operand !== position) continue;
    const holder = origin.kind === "Operand" ? "" : origin.kind === "Content" && origin.depth === 1 && typeof origin.key === "string" ? origin.key : undefined;
    if (holder === undefined) continue;
    let known = names.get(holder);
    if (!known) names.set(holder, (known = new Set()));
    known.add(key);
  }
}

type Filler = { name: string; create(log: Log, operand: OperandName, key: string): unknown };

const fillers: Filler[] = [
  { name: "strings", create: () => "a" },
  { name: "numbers", create: () => 1 },
  { name: "true", create: () => true },
  { name: "false", create: () => false },
  { name: "functions", create: (log, operand, key) => createCallback(log, contentOrigin(operand, "Property", key), () => undefined) },
  { name: "objects", create: () => ({ a: 1 }) },
  { name: "arrays", create: () => ["a", "b"] },
  { name: "buffers", create: () => Buffer.alloc(16) },
];

const maxNames = 48;

function fill(log: Log, operand: OperandName, names: Iterable<string>, filler: Filler): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  for (const name of [...names].slice(0, maxNames)) bag[name] = filler.create(log, operand, name);
  return bag;
}

// Real objects with every name that was looked for. One of them holds recording objects, which show the names looked for one level down.
export function optionBags(names: NamesRead): Candidate[] {
  const top = names.get("");
  if (!top || top.size === 0) return [];
  const nestedHolders = [...names.keys()].filter(holder => holder !== "");
  const bags = fillers.map(filler => realObject(`bag:${filler.name}`, (log, operand) => fill(log, operand, top, filler)));
  bags.push(
    realObject("bag:recording", (log, operand) => {
      const bag: Record<string, unknown> = {};
      for (const name of [...top].slice(0, maxNames)) bag[name] = log.track({}, contentOrigin(operand, "Property", name));
      return bag;
    }),
  );
  if (nestedHolders.length === 0) return bags;
  for (const filler of fillers) {
    bags.push(
      realObject(`bag:nested:${filler.name}`, (log, operand) => {
        const bag = fill(log, operand, top, filler);
        for (const holder of nestedHolders) bag[holder] = fill(log, operand, names.get(holder)!, filler);
        return bag;
      }),
    );
  }
  return bags;
}

const candidatesByName = new Map(
  [...realObjects, ...pathCandidates, ...ownerCandidates, ...networkCandidates].map(candidate => [candidate.name, candidate]),
);

function candidateNamed(name: string): Candidate {
  if (name === "descriptor") return descriptorCandidate;
  return candidatesByName.get(name) ?? everyCandidate.find(candidate => candidate.name === name) ?? findCandidate(name);
}

// Operands in the order in which Bun's own modules pass them, for functions that refuse every combination of kinds above.
const writtenSets: [RegExp, string[][]][] = [
  [
    /%NodeJSFS%\.prototype\.read(Sync)?$/,
    [
      ["descriptor", "large:Buffer"],
      ["descriptor", "large:Buffer", "primitive:0", "primitive:3", "primitive:0"],
      ["descriptor", "large:Uint8Array", "primitive:1", "primitive:2", "primitive:null"],
      ["descriptor", "filled:DataView", "primitive:0", "primitive:3", "primitive:0"],
    ],
  ],
  [/%NodeJSFS%\.prototype\.readCb$/, [["callback:undefined", "descriptor", "large:Buffer", "primitive:0", "primitive:3", "primitive:0"]]],
  [/%NodeJSFS%\.prototype\.readv(Sync)?$/, [["descriptor", "buffers:Array", "primitive:0"], ["descriptor", "buffers:Array"]]],
  [/%NodeJSFS%\.prototype\.readvCb$/, [["callback:undefined", "descriptor", "buffers:Array", "primitive:0"]]],
  [
    /%Native(Zlib|Brotli|Zstd)%\.prototype\.write(Sync)?$/,
    [["primitive:0", "filled:Buffer", "primitive:0", "primitive:8", "large:Buffer", "primitive:0", "primitive:256"]],
  ],
  [/%NativeZlib%\.prototype\.init$/, [["primitive:16", "primitive:3", "primitive:8", "primitive:0", "filled:Uint32Array", "callback:undefined", "primitive:undefined"]]],
  [/%NodeJSFS%\.prototype\.writev(Sync)?$/, [["descriptor", "buffers:Array", "primitive:0"], ["descriptor", "buffers:Array"]]],
  [/%NodeJSFS%\.prototype\.writevCb$/, [["callback:undefined", "descriptor", "buffers:Array", "primitive:0"]]],
  [/%NodeJSFS%\.prototype\.(access|unlink|rm|realpath|realpathNative|statfs)Sync$/, [["path:file"], ["path:file:Buffer"]]],
  [/%NodeJSFS%\.prototype\.l?chmodSync$/, [["path:file", "primitive:1"], ["path:file:Buffer", "primitive:1"]]],
  [/%NodeJSFS%\.prototype\.l?chownSync$/, [["path:file", "owner:user", "owner:group"], ["path:file:Buffer", "owner:user", "owner:group"]]],
  [/%NodeJSFS%\.prototype\.fchownSync$/, [["descriptor", "owner:user", "owner:group"]]],
  [/%NodeJSFS%\.prototype\.(copyFile|cp|link)Sync$/, [["path:file", "path:free"], ["path:file:Buffer", "path:free:Buffer"]]],
  [/%NodeJSFS%\.prototype\.lutimesSync$/, [["path:file", "primitive:1", "primitive:1"]]],
  [/%NodeJSFS%\.prototype\.readdirSync$/, [["path:folder"], ["path:folder:Buffer"]]],
  [/%NodeJSFS%\.prototype\.readlinkSync$/, [["path:link"], ["path:link:Buffer"]]],
  [/%NodeJSFS%\.prototype\.rmdirSync$/, [["path:emptyFolder"], ["path:emptyFolder:Buffer"]]],
  [/node_validators\.bind\.ts:validateOneOf$/, [['primitive:"a"', 'primitive:"a"', "strings:Array"]]],
  [/%BlockList%\.prototype\.addAddress$/, [["host:SocketAddress"]]],
  [/%BlockList%\.prototype\.addRange$/, [["host:SocketAddress", "host:SocketAddress"]]],
  [/%BlockList%\.prototype\.addSubnet$/, [["host:SocketAddress", "primitive:8"]]],
  [/%UDPSocket%\.prototype\.send$/, [["filled:Buffer", "port:discard", "address:loopback"], ['primitive:"a"', "port:discard", "address:loopback"]]],
  [/%UDPSocket%\.prototype\.(add|drop)Membership$/, [["address:multicast"], ["address:multicast", "address:loopback"]]],
  [/%UDPSocket%\.prototype\.(add|drop)SourceSpecificMembership$/, [["address:loopback", "address:multicast"]]],
  [/%(TCPSocket|TLSSocket|Listener)%\.prototype\.reload$/, [["socket:handlers"]]],
  [/%TLSSocket%\.prototype\.exportKeyingMaterial$/, [["primitive:16", "text:label"], ["primitive:16", "text:label", "filled:Buffer"]]],
  [/%TLSSocket%\.prototype\.setVerifyMode$/, [["primitive:true", "primitive:false"]]],
  [/%TLSSocket%\.prototype\.getPeerCertificate$/, [["primitive:true"], ["primitive:false"]]],
  [/%UDPSocket%\.prototype\.sendMany$/, [["buffers:Array"], ["mixed:Array"]]],
  [/%(TCP|TLS)Socket%\.prototype\.(write|end)$/, [["large:Buffer", "primitive:0", "primitive:8"], ["large:Uint8Array"]]],
];

export function setsAsWritten(path: string, receiver: Candidate, argumentCount: number): OperandSet[] {
  const notPassed = findCandidate("primitive:undefined");
  return writtenSets.flatMap(([pattern, vectors]) =>
    pattern.test(path)
      ? vectors.map(vector =>
          createSet(receiver, [...vector.map(candidateNamed), ...Array<Candidate>(Math.max(argumentCount - vector.length, 0)).fill(notPassed)]),
        )
      : [],
  );
}
