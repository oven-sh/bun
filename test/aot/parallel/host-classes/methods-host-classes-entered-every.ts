// Methods of host classes are entered with every number of arguments.
function framesOf(stack: string | undefined): string {
  return (stack ?? "")
    .split("\n")
    .slice(1, 4)
    .map(line => /^\s*at (\S+) \(/.exec(line)?.[1] ?? "-")
    .join(" < ");
}

function show(label: string, run: () => unknown) {
  try {
    const value = run();
    console.log(label, typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
  } catch (error) {
    const e = error as Error & { code?: string };
    console.log(label, "threw", e.name, e.code ?? "-", e.message, "|", framesOf(e.stack));
  }
}

const decoder = new TextDecoder();
const bytes = new Uint8Array([104, 105, 33]);
show("decode", () => decoder.decode(bytes));
show("decode nothing", () => decoder.decode());
show("decode with options", () => decoder.decode(bytes, { stream: false }));
show("decode a number", () => (decoder as any).decode(5));
show("decode with more arguments", () => (decoder as any).decode(bytes, undefined, 1, 2, 3, 4, 5, 6, 7));

const hasher = new Bun.CryptoHasher("sha1");
show("update", () => hasher.update("abc") === hasher);
show("digest", () => hasher.digest("hex"));
show("update nothing", () => (new Bun.CryptoHasher("sha1") as any).update());
show("digest of an unknown encoding", () => (new Bun.CryptoHasher("sha1") as any).digest("nothing"));

const glob = new Bun.Glob("*.ts");
show("match", () => glob.match("a.ts"));
show("no match", () => glob.match("a.js"));
show("match a number", () => (glob as any).match(1));

const blob = new Blob(["hello world"]);
show("slice", () => blob.slice(0, 5).size);
show("slice nothing", () => blob.slice().size);

function callOn(receiver: any) {
  return TextDecoder.prototype.decode.call(receiver, bytes);
}
show("another receiver", () => callOn({}));
show("the right receiver", () => callOn(decoder));

class Below extends TextDecoder {}
show("a class below", () => new Below().decode(bytes));
const inheriting = Object.create(decoder);
show("an object above which the instance stands", () => inheriting.decode(bytes));

let total = 0;
for (let i = 0; i < 1000; i++) total += decoder.decode(bytes).length + (glob.match("x" + i + ".ts") ? 1 : 0);
console.log("total", total);

const text = await blob.text();
console.log("text", text);
const kept: string[] = [];
for (let i = 0; i < 20000; i++) {
  const made = decoder.decode(new Uint8Array([65 + (i % 26), 66, 67]));
  if (i % 5000 === 0) {
    Bun.gc(true);
    kept.push(made);
  }
}
console.log("kept", kept.join(","));
