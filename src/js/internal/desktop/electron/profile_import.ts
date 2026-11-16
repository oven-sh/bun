// Reads the cookies and the `localStorage` that Electron has left in the directory of a session.
const fs = require("node:fs");
const path = require("node:path");

class Reader {
  at = 0;
  constructor(readonly data: Buffer) {}

  number() {
    let result = 0;
    for (let scale = 1; ; scale *= 128) {
      const byte = this.data.readUInt8(this.at++);
      result += (byte & 127) * scale;
      if (byte < 128) return result;
    }
  }

  bytes(length = this.number()) {
    if (this.at + length > this.data.length) throw new RangeError("The file is cut off");
    return this.data.subarray(this.at, (this.at += length));
  }
}

function unsnappy(data: Buffer) {
  const input = new Reader(data);
  const output = Buffer.alloc(input.number());
  let at = 0;
  while (input.at < data.length) {
    const tag = data[input.at++];
    const kind = tag & 3;
    let length = tag >> 2;
    if (kind === 0) {
      if (length >= 60) length = input.bytes(length - 59).readUIntLE(0, length - 59);
      at += input.bytes(length + 1).copy(output, at);
      continue;
    }
    const size = 1 << (kind - 1);
    let offset = input.bytes(size).readUIntLE(0, size);
    if (kind === 1) {
      offset += (tag >> 5) << 8;
      length = (length & 7) + 3;
    }
    for (const end = at + length + 1; at < end; at++) output[at] = output[at - offset];
  }
  return output;
}

type Put = (key: Buffer, sequence: number, value: Buffer | null) => void;

function readTable(file: Buffer, put: Put) {
  function* entries(handle: Reader) {
    const [offset, size] = [handle.number(), handle.number()];
    let block = file.subarray(offset, offset + size);
    if (file[offset + size] === 1) block = unsnappy(block);
    const reader = new Reader(block);
    const end = block.length - 4 * (block.readUInt32LE(block.length - 4) + 1);
    let key = Buffer.alloc(0);
    while (reader.at < end) {
      const [shared, rest, length] = [reader.number(), reader.number(), reader.number()];
      key = Buffer.concat([key.subarray(0, shared), reader.bytes(rest)]);
      yield [key, reader.bytes(length)];
    }
  }
  const footer = new Reader(file.subarray(-48));
  footer.number();
  footer.number();
  for (const [, handle] of entries(footer)) {
    for (const [key, value] of entries(new Reader(handle))) {
      // A byte for the type, and then the sequence number, which no profile takes past 48 bits.
      put(key.subarray(0, -8), key.readUIntLE(key.length - 7, 6), key[key.length - 8] === 1 ? value : null);
    }
  }
}

function readLog(file: Buffer, put: Put) {
  const BLOCK = 32768;
  let parts: Buffer[] = [];
  for (let at = 0; at + 7 <= file.length;) {
    const type = BLOCK - (at % BLOCK) < 7 ? 0 : file[at + 6];
    if (type === 0) {
      at += BLOCK - (at % BLOCK);
      continue;
    }
    const end = at + 7 + file.readUInt16LE(at + 4);
    if (end > file.length) return;
    if (type <= 2) parts = [];
    parts.push(file.subarray(at + 7, (at = end)));
    if (type === 2 || type === 3) continue;
    const batch = new Reader(Buffer.concat(parts));
    let sequence = batch.bytes(12).readUIntLE(0, 6);
    while (batch.at < batch.data.length) {
      const isValue = batch.number() === 1;
      put(batch.bytes(), sequence++, isValue ? batch.bytes() : null);
    }
  }
}

function readLevelDB(directory: string) {
  const newest = new Map<string, [number, Buffer | null]>();
  const put: Put = (key, sequence, value) => {
    const name = key.latin1Slice();
    if (!((newest.$get(name)?.[0] ?? -1) > sequence)) newest.$set(name, [sequence, value]);
  };
  for (const name of fs.readdirSync(directory)) {
    const read = { ".log": readLog, ".ldb": readTable, ".sst": readTable }[path.extname(name)];
    read?.(fs.readFileSync(path.join(directory, name)), put);
  }
  return newest;
}

/** `[origin, key, value]` */
function localStorage(directory: string) {
  const text = (data: Buffer) => data.toString(data[0] === 0 ? "utf16le" : "latin1", 1);
  const items: [string, string, string][] = [];
  readLevelDB(path.join(directory, "Local Storage", "leveldb")).$forEach(([, value], key) => {
    const end = key.indexOf("\0");
    const origin = key.slice(1, end).replace(/\/$/, "");
    // `^` is in the keys of frames within other sites.
    if (value === null || key[0] !== "_" || end < 0 || origin.includes("^")) return;
    items.push([origin, text(Buffer.from(key.slice(end + 1), "latin1")), text(value)]);
  });
  return items;
}

function cookies(directory: string) {
  const file = [path.join(directory, "Network", "Cookies"), path.join(directory, "Cookies")].find(fs.existsSync);
  if (!file) return [];
  const { decrypt } = require("internal/desktop/electron/os_crypt");
  const { Database } = require("bun/sqlite");
  using sql = Database.deserialize(fs.readFileSync(file), { readonly: true });
  const startsWithHash = +sql.query("SELECT value FROM meta WHERE key = 'version'").get().value >= 24;
  return sql
    .query(
      "SELECT *, expires_utc / 1e6 - 11644473600 AS expires FROM cookies WHERE is_persistent AND top_frame_site_key = '' ORDER BY creation_utc",
    )
    .all()
    .map(row => ({
      name: row.name,
      value:
        row.encrypted_value.length === 0
          ? row.value
          : decrypt(Buffer.from(row.encrypted_value)).toString("utf8", startsWithHash ? 32 : 0),
      domain: row.host_key,
      hostOnly: row.host_key[0] !== ".",
      path: row.path,
      secure: !!row.is_secure,
      httpOnly: !!row.is_httponly,
      session: false,
      expirationDate: row.expires,
      sameSite: ["no_restriction", "lax", "strict"][row.samesite] ?? "unspecified",
    }));
}

export default { cookies, localStorage };
