// Run `bun bd bench/sqlite/async-availability.js --quick` for a bounded smoke run.
// This measures repeated zero-delay timer gaps, not a universal SQLite speed ranking.
import { AsyncDatabase, Database } from "bun:sqlite";

const SMALL_QUERY = "SELECT value FROM hot WHERE id = ?";
const LONG_QUERY = `
  WITH RECURSIVE counter(value) AS (
    VALUES(1)
    UNION ALL
    SELECT value + 1 FROM counter WHERE value < ?
  )
  SELECT sum(value) AS total FROM counter
`;

const args = new Set(process.argv.slice(2));
if (args.has("--help")) {
  console.log(`Usage: bun bench/sqlite/async-availability.js [--quick]

Compares synchronous Database, a manually managed Worker using synchronous
Database, and AsyncDatabase. --quick uses fewer cache-hot queries and a smaller
recursive query for smoke runs. Query wall time includes dispatch/Promise
overhead; maximum timer gap measures event-loop availability. Worker startup and
database setup are intentionally excluded.`);
  process.exit(0);
}

for (const arg of args) {
  if (arg !== "--quick") {
    throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
  }
}

const quick = args.has("--quick");
const config = quick
  ? { smallOperations: 500, recursiveLimit: 50_000 }
  : { smallOperations: 10_000, recursiveLimit: 1_000_000 };

function expectedSum(limit) {
  return (limit * (limit + 1)) / 2;
}

function expectedSmallChecksum(operations) {
  let checksum = 0;
  for (let i = 0; i < operations; i++) {
    checksum += `value-${i & 255}`.length;
  }
  return checksum;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function setupSyncDatabase() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE hot (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO hot (id, value) VALUES (?, ?)");
  for (let id = 0; id < 256; id++) {
    insert.run(id, `value-${id}`);
  }
  insert.finalize();
  const smallStatement = db.query(SMALL_QUERY);
  const longStatement = db.query(LONG_QUERY);

  return {
    close: () => db.close(),
    runLong: limit => longStatement.get([limit]).total,
    runSmall: operations => {
      let checksum = 0;
      for (let i = 0; i < operations; i++) {
        checksum += smallStatement.get([i & 255]).value.length;
      }
      return checksum;
    },
  };
}

async function setupAsyncDatabase() {
  const db = await AsyncDatabase.open(":memory:");
  try {
    await db.exec("CREATE TABLE hot (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    for (let id = 0; id < 256; id++) {
      await db.run("INSERT INTO hot (id, value) VALUES (?, ?)", [id, `value-${id}`]);
    }

    return {
      close: () => db.close(),
      runLong: async limit => (await db.get(LONG_QUERY, [limit])).total,
      runSmall: async operations => {
        let checksum = 0;
        for (let i = 0; i < operations; i++) {
          checksum += (await db.get(SMALL_QUERY, [i & 255])).value.length;
        }
        return checksum;
      },
    };
  } catch (error) {
    try {
      await db.close();
    } catch {}
    throw error;
  }
}

function createWorkerDatabase() {
  const worker = new Worker(new URL("./async-availability-worker.js", import.meta.url).href);
  let nextId = 0;
  let failure;
  const pending = new Map();

  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error !== undefined) {
      request.reject(new Error(data.error));
    } else {
      request.resolve(data.result);
    }
  };
  worker.onerror = event => {
    failure ??= event.error ?? new Error(event.message);
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  };

  const request = (operation, payload = {}) => {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, operation, ...payload });
    });
  };

  return {
    close: async () => {
      try {
        if (!failure) await request("close");
      } finally {
        await worker.terminate();
      }
    },
    setup: () => request("setup"),
    runLong: limit => request("long", { limit }),
    runSmall: operations => request("small", { operations }),
  };
}

async function measure(action, operations) {
  let maxTimerGapMs = 0;
  let lastTimerTick = performance.now();
  let timer;

  const sampleTimer = () => {
    const now = performance.now();
    maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTimerTick);
    lastTimerTick = now;
  };
  const scheduleSample = () => {
    timer = setTimeout(() => {
      sampleTimer();
      scheduleSample();
    }, 0);
  };

  scheduleSample();
  const startedAt = performance.now();
  let result;
  let wallMs;
  try {
    result = await action();
  } finally {
    wallMs = performance.now() - startedAt;
    clearTimeout(timer);
    try {
      await new Promise(resolve => {
        timer = setTimeout(() => {
          timer = undefined;
          sampleTimer();
          resolve();
        }, 0);
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return {
    maxTimerGapMs,
    wallMs,
    throughputPerSecond: (operations * 1000) / wallMs,
    result,
    operations,
  };
}

function format(result) {
  return {
    "query wall ms": Number(result.wallMs.toFixed(2)),
    "queries/sec": Number(result.throughputPerSecond.toFixed(2)),
    "max timer gap ms": Number(result.maxTimerGapMs.toFixed(2)),
  };
}

async function measureImplementation(name, database) {
  const expectedChecksum = expectedSmallChecksum(config.smallOperations);
  const warmChecksum = await database.runSmall(1);
  assertEqual(warmChecksum, 7, `${name} warm query`);

  const hot = await measure(() => database.runSmall(config.smallOperations), config.smallOperations);
  assertEqual(hot.result, expectedChecksum, `${name} cache-hot query`);

  const long = await measure(() => database.runLong(config.recursiveLimit), 1);
  assertEqual(long.result, expectedSum(config.recursiveLimit), `${name} recursive query`);

  return { name, hot, long };
}

let sync;
let worker;
let asyncDatabase;

try {
  sync = setupSyncDatabase();
  worker = createWorkerDatabase();
  asyncDatabase = await setupAsyncDatabase();
  await worker.setup();

  const results = [];
  results.push(await measureImplementation("Database (synchronous)", sync));
  results.push(await measureImplementation("Database in manual Worker", worker));
  results.push(await measureImplementation("AsyncDatabase", asyncDatabase));

  console.log(`Async SQLite availability benchmark (${quick ? "quick" : "default"})`);
  console.log("Maximum timer gap is sampled with repeated zero-delay timers plus one final tick after each workload.");
  for (const result of results) {
    console.log(`\n${result.name}`);
    console.table({
      "cache-hot small query": format(result.hot),
      "recursive query": format(result.long),
    });
  }
} finally {
  await Promise.allSettled([
    sync ? Promise.resolve(sync.close()) : undefined,
    worker ? worker.close() : undefined,
    asyncDatabase ? asyncDatabase.close() : undefined,
  ]);
}
