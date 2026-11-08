// A compiled loop reads the length of a view and the address of its bytes once, in front of the loop, and stores into the bytes in every turn without
// asking again, wherever nothing in the turn runs other code or writes the storage of views. For a call of a built-in that is what its row of the
// table says. So a row that says neither, and whose function makes a buffer for a view, detaches one or cuts one, lets the loop write into memory
// that is no longer the view's.
//
// Every such overload is called here with small views that were made by a length: their bytes lie in memory of the collector and move when a buffer
// is first made. Behind the call each view must have no buffer and its length.
//
//   AOT_BUILTINS_FILTER=<r>  only the functions whose path matches the regular expression
import { aotBuiltinEntries, arrayBufferViewHasBuffer } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { beforeAll, test } from "../supported";
import type { ViewReport } from "./native-contract/check-views";
import { runWorkers, type Results } from "./native-contract/run-workers";
import { isQuietForViews } from "./native-contract/targets";

const filter = process.env.AOT_BUILTINS_FILTER ?? ".";
const quiet = aotBuiltinEntries().entries.flatMap(entry =>
  new RegExp(filter).test(entry.path) ? entry.overloads.filter(isQuietForViews).map(overload => overload.token) : [],
);
const maxWorkers = 2;

// A view that is made by a length and then filled has no buffer either.
const filled = (bytes: ArrayLike<number>) => {
  const view = new Uint8Array(bytes.length);
  view.set(bytes);
  return view;
};
const text = (characters: string) => filled(Array.from(characters, character => character.charCodeAt(0)));
const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];

// With the operands that the workers make, the overloads of these that take a view only ever throw: they want a stream, a text, a hash or a module.
const callsAsMeant: [
  path: string,
  mode: "Call" | "Construct",
  make: () => ArrayBufferView[],
  call: (...views: any[]) => unknown,
][] = [
  ["Bun.gunzipSync", "Call", () => [filled(Bun.gzipSync("a"))], stream => Bun.gunzipSync(stream)],
  ["Bun.inflateSync", "Call", () => [filled(Bun.deflateSync("a"))], stream => Bun.inflateSync(stream)],
  [
    "Bun.zstdDecompressSync",
    "Call",
    () => [filled(Bun.zstdCompressSync("a"))],
    stream => Bun.zstdDecompressSync(stream),
  ],
  ["Bun.JSON5.parse", "Call", () => [text("{a:1}")], written => Bun.JSON5.parse(written)],
  ["Bun.TOML.parse", "Call", () => [text("a = 1")], written => Bun.TOML.parse(written)],
  ["Bun.JSONL.parse", "Call", () => [text('{"a":1}\n')], written => Bun.JSONL.parse(written)],
  [
    "Bun.password.verifySync",
    "Call",
    () => [text("word"), text(Bun.password.hashSync("word", { algorithm: "bcrypt", cost: 4 }))],
    (word, hash) => Bun.password.verifySync(word, hash),
  ],
  ["Bun.CryptoHasher", "Construct", () => [text("key")], key => new Bun.CryptoHasher("sha256", key)],
  ["BigInt64Array", "Construct", () => [new BigUint64Array(2)], view => new BigInt64Array(view)],
  ["BigUint64Array", "Construct", () => [new BigInt64Array(2)], view => new BigUint64Array(view)],
  ["Uint8Array.prototype.setFromHex", "Call", () => [new Uint8Array(12)], view => view.setFromHex("0a0b")],
  ["WebAssembly.Module", "Construct", () => [filled(emptyModule)], module => new WebAssembly.Module(module)],
  ["Blob", "Construct", () => [text("ab")], view => new Blob([view])],
  ["Buffer.from", "Call", () => [text("ab")], view => Buffer.from(view)],
];

const run = async (options: { filter: string; toldQuiet?: string }) => {
  using folder = tempDir("aot-quiet-rows-and-views", {});
  return await runWorkers({
    executable: bunExe(),
    environment: bunEnv,
    folder: String(folder),
    workerCount: Math.min(availableParallelism(), maxWorkers),
    worker: "views-worker.ts",
    ...options,
  });
};
const called = (results: Results) =>
  [...results.reports.values()].filter((report): report is ViewReport => "changes" in report && "callCount" in report);
const changesIn = (results: Results) =>
  called(results).flatMap(({ name, changes }) => changes.map(change => `${name}: ${change}`));

function defineTests() {
  if (quiet.length === 0) return void test.skip("this build of Bun has no ahead-of-time compiler", () => {});

  let results: Results;
  beforeAll(async () => {
    results = await run({ filter });
  }, 30 * 60_000);

  test("every quiet overload has a report", () => {
    expect(quiet.filter(token => !results.reports.has(token) && !results.ended.includes(token))).toEqual([]);
  });

  test("no call ends its process or stays away", () => {
    expect(results.howEnded).toEqual([]);
  });

  // Most quiet overloads take no view anywhere. Of those that do, one that only ever throws has shown little.
  test("most of the overloads that take a view return from some call", () => {
    if (filter !== ".") return;
    const takingViews = called(results).filter(({ callCount }) => callCount > 0);
    expect(takingViews).not.toEqual([]);
    expect(takingViews.filter(({ returned }) => returned > 0).length).toBeGreaterThan(takingViews.length / 2);
  });

  test("behind a call of a quiet overload a view has no buffer and its length", () => {
    expect(changesIn(results)).toEqual([]);
  });

  test.each(callsAsMeant)("%s, called as it is meant to be", async (path, mode, make, call) => {
    const views = make();
    const lengths = views.map(({ byteLength }) => byteLength);
    await call(...views);
    const overloads = aotBuiltinEntries()
      .entries.filter(entry => entry.path === path)
      .flatMap(({ overloads }) => overloads);
    expect(overloads.filter(overload => overload.mode === mode)).not.toEqual([]);
    // One whose rows all say that it writes the storage of views may.
    if (!overloads.some(overload => overload.mode === mode && isQuietForViews(overload))) return;
    expect(views.map(view => arrayBufferViewHasBuffer(view))).toEqual(views.map(() => false));
    expect(views.map(({ byteLength }) => byteLength)).toEqual(lengths);
  });

  test("a file is written out of a view", async () => {
    using folder = tempDir("aot-quiet-rows-and-views", {});
    const view = text("ab");
    await Bun.file(join(String(folder), "written.txt")).write(view);
    expect(arrayBufferViewHasBuffer(view)).toBe(false);
  });

  // Their rows are made off their bindings, whose argument is `held: "pinned"`. They run other code today. A row that no longer does still has to say it.
  test.each(["zstdCompress", "zstdDecompress"] as const)(
    "Bun.%s pins a view, and its row says that it writes the storage of views",
    async name => {
      const view = new Uint8Array(12);
      await Bun[name](view).catch(() => {});
      expect(arrayBufferViewHasBuffer(view)).toBe(true);
      const overloads = aotBuiltinEntries()
        .entries.filter(({ path }) => path === `Bun.${name}`)
        .flatMap(({ overloads }) => overloads);
      expect(overloads).not.toEqual([]);
      expect(
        overloads
          .filter(({ mode, writes }) => mode === "Call" && !writes.includes("TypedArrayStorage"))
          .map(({ token }) => token),
      ).toEqual([]);
    },
  );

  // Each of these makes the buffer, and its row says so. Taken for quiet it has to be caught.
  test.each(["%TypedArray%.prototype.buffer", "structuredClone", "Bun.file"])(
    "the row of %s, taken for quiet, is caught",
    async path => {
      const pattern = `^${RegExp.escape(path)}$`;
      const lying = await run({ filter: pattern, toldQuiet: pattern });
      expect(lying.howEnded).toEqual([]);
      expect(changesIn(lying).filter(change => change.includes("a buffer was made for it"))).not.toEqual([]);
    },
    5 * 60_000,
  );
}

defineTests();
