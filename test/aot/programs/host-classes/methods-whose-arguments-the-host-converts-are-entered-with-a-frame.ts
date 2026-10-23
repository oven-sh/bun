// A method of a host class that converts its own arguments is entered at its host function: any receiver, any arguments, any number of them.
// STATISTIC: NativeFunctionsCalledDirectly >= 5
type Wide = {
  match(...all: unknown[]): unknown;
  update(...all: unknown[]): unknown;
  digest(...all: unknown[]): unknown;
  decode(...all: unknown[]): unknown;
};

function say(run: () => unknown): string {
  try {
    const answer = run();
    return typeof answer === "object" && answer !== null ? Object.prototype.toString.call(answer) : String(answer);
  } catch (error) {
    return `${(error as Error).name} ${(error as { code?: string }).code ?? ""}: ${(error as Error).message}`;
  }
}

const glob = new Bun.Glob("*.ts");
const decoder = new TextDecoder();
const bytes = new Uint8Array([104, 105]);
let conversions = 0;
const counted = {
  toString() {
    conversions++;
    return "counted.ts";
  },
};
const throwing = {
  toString(): string {
    throw new RangeError("no text");
  },
};

function matchTyped(subject: Bun.Glob, text: string): boolean {
  return subject.match(text);
}
function matchWide(subject: Wide, text: unknown): unknown {
  return subject.match(text, 1, 2, 3, 4, 5, 6, 7, 8, 9);
}
function matchNothing(subject: Wide): unknown {
  return subject.match();
}
function hash(subject: Bun.CryptoHasher, text: string | Uint8Array): string {
  subject.update(text);
  return subject.digest("hex");
}
function hashWide(subject: Wide, data: unknown, encoding: unknown): unknown {
  subject.update(data, encoding, 0, 0, 0, 0, 0, 0);
  return subject.digest("hex", 0, 0, 0, 0, 0, 0, 0);
}
function decodeTyped(subject: TextDecoder, from: Uint8Array): string {
  return subject.decode(from);
}
function decodeWide(subject: Wide, from: unknown, options: unknown): unknown {
  return subject.decode(from, options, 1, 2, 3, 4, 5, 6);
}

const impostor: Wide = {
  match: (...all) => `impostor match ${all.length}`,
  update: (...all) => `impostor update ${all.length}`,
  digest: (...all) => `impostor digest ${all.length}`,
  decode: (...all) => `impostor decode ${all.length}`,
};
const heir = Object.create(glob) as Wide;
const borrowed = { match: glob.match, update: Bun.CryptoHasher.prototype.update, digest: Bun.CryptoHasher.prototype.digest, decode: decoder.decode } as unknown as Wide;

const lines: string[] = [];
for (let round = 0; round < 3; round++) {
  lines.push(String(matchTyped(glob, "a.ts")), String(matchTyped(glob, "a.js")));
  for (const subject of [glob as unknown as Wide, impostor, heir, borrowed]) {
    for (const text of ["b.ts", "b.js", counted, throwing, 7, undefined, null, Symbol.iterator, 3n, ["c.ts"]]) {
      lines.push(say(() => matchWide(subject, text)));
    }
    lines.push(say(() => matchNothing(subject)));
  }
  lines.push(hash(new Bun.CryptoHasher("sha1"), "abc"), hash(new Bun.CryptoHasher("md5"), bytes));
  for (const subject of [new Bun.CryptoHasher("sha256") as unknown as Wide, impostor, borrowed]) {
    for (const data of ["abc", bytes, 7, undefined, {}, throwing]) {
      lines.push(say(() => hashWide(subject, data, undefined)));
      lines.push(say(() => hashWide(subject, data, "hex")));
    }
  }
  lines.push(decodeTyped(decoder, bytes));
  for (const subject of [decoder as unknown as Wide, impostor, borrowed]) {
    for (const from of [bytes, bytes.buffer, undefined, "text", 7, {}]) {
      lines.push(say(() => decodeWide(subject, from, undefined)));
      lines.push(say(() => decodeWide(subject, from, { stream: true })));
      lines.push(say(() => decodeWide(subject, from, 5)));
    }
  }
}
console.log(lines.length, conversions);
console.log(lines.slice(0, lines.length / 3).join("\n"));
console.log(lines.slice(0, lines.length / 3).join() === lines.slice(lines.length / 3, (2 * lines.length) / 3).join());
