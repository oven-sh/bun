// Accessors of host classes are read in loops while other accessor functions are made and dropped, much is allocated and the collector runs between the reads.
function describeUrl(url: URL): string {
  return [
    url.href,
    url.origin,
    url.protocol,
    url.username,
    url.password,
    url.host,
    url.hostname,
    url.port,
    url.pathname,
    url.search,
    url.hash,
    url.searchParams.size,
  ].join(" ");
}

function describeRequest(request: Request): string {
  return [
    request.method,
    request.url,
    request.mode,
    request.cache,
    request.redirect,
    request.credentials,
    request.referrerPolicy,
    request.bodyUsed,
    request.headers.count,
    request.signal.aborted,
  ].join(" ");
}

function describeResponse(response: Response): string {
  return [
    response.status,
    response.statusText,
    response.ok,
    response.type,
    response.redirected,
    response.bodyUsed,
    response.url.length,
    response.headers.count,
  ].join(" ");
}

function describeRest(blob: Blob, decoder: TextDecoder, encoder: TextEncoder, hasher: Bun.CryptoHasher): string {
  return [
    blob.size,
    blob.type,
    decoder.encoding,
    decoder.fatal,
    decoder.ignoreBOM,
    encoder.encoding,
    hasher.algorithm,
    hasher.byteLength,
  ].join(" ");
}

const holders: object[] = [
  URL.prototype,
  URLSearchParams.prototype,
  Request.prototype,
  Response.prototype,
  Blob.prototype,
  TextDecoder.prototype,
  TextEncoder.prototype,
  Bun.CryptoHasher.prototype,
  Event.prototype,
  AbortSignal.prototype,
  AbortController.prototype,
  Intl.Locale.prototype,
  Intl.NumberFormat.prototype,
  Intl.DateTimeFormat.prototype,
  Intl.Collator.prototype,
];

function makeAccessorFunctions(from: number): number {
  let made = 0;
  for (let index = 0; index < holders.length; index++) {
    const holder = holders[(index + from) % holders.length];
    for (const name of Object.getOwnPropertyNames(holder)) {
      const descriptor = Object.getOwnPropertyDescriptor(holder, name)!;
      if (typeof descriptor.get === "function") made++;
      if (typeof descriptor.set === "function") made++;
    }
  }
  return made;
}

let kept: unknown[] = [];
function allocate(turn: number): number {
  const list: unknown[] = [];
  for (let index = 0; index < 300; index++) {
    switch ((index + turn) % 6) {
      case 0:
        list.push({ index, turn });
        break;
      case 1:
        list.push([index, turn, index + turn]);
        break;
      case 2:
        list.push("text " + index + " of " + turn);
        break;
      case 3:
        list.push(() => index + turn);
        break;
      case 4:
        list.push(function () {
          return index;
        });
        break;
      default:
        list.push(new Map([[index, turn]]));
    }
  }
  kept = turn % 3 ? list : [];
  return list.length;
}

function run(label: string, takesDescriptorsFirst: boolean) {
  if (takesDescriptorsFirst) {
    makeAccessorFunctions(0);
    Bun.gc(true);
  }
  const seen = new Map<string, number>();
  let made = 0;
  let allocated = 0;
  for (let turn = 0; turn < 10; turn++) {
    const url = new URL(`https://user:word@example.com:8${turn % 10}43/a/b?x=${turn % 4}&y=2#part`);
    const request = new Request(url.href, { method: turn % 2 ? "POST" : "GET", headers: { a: "1", b: "2" } });
    const response = new Response("body", { status: 200 + (turn % 5), statusText: "fine", headers: { c: "3" } });
    const blob = new Blob(["four"], { type: "text/plain" });
    const decoder = new TextDecoder("utf-8", { fatal: turn % 2 === 0 });
    const encoder = new TextEncoder();
    const hasher = new Bun.CryptoHasher(turn % 2 ? "sha256" : "md5");
    for (let inner = 0; inner < 16; inner++) {
      const text = [
        describeUrl(url),
        describeRequest(request),
        describeResponse(response),
        describeRest(blob, decoder, encoder, hasher),
      ].join(" ; ");
      seen.set(text, (seen.get(text) ?? 0) + 1);
      if (inner % 8 === 3) made += makeAccessorFunctions(turn + inner);
      if (inner % 8 === 5) allocated += allocate(turn + inner);
      if (inner % 8 === 7) Bun.gc(inner % 16 === 7);
    }
  }
  console.log(label, seen.size, made, allocated, kept.length);
  for (const [text, count] of [...seen].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, 4)) console.log(count, text);
}

run("reads first", false);
run("descriptors first", true);
