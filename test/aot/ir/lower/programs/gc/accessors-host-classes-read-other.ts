// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: describeUrl describeRequest describeRest
// CHECK-LABEL: function {{*}}name="describeUrl"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|URL flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|URL):
// CHECK-NEXT: v1 = PropGet v0 key="href"
// CHECK-NEXT: v2 = PropGet v0 key="origin"
// CHECK-NEXT: v3 = PropGet v0 key="protocol"
// CHECK-NEXT: v4 = PropGet v0 key="username"
// CHECK-NEXT: v5 = PropGet v0 key="password"
// CHECK-NEXT: v6 = PropGet v0 key="host"
// CHECK-NEXT: v7 = PropGet v0 key="hostname"
// CHECK-NEXT: v8 = PropGet v0 key="port"
// CHECK-NEXT: v9 = PropGet v0 key="pathname"
// CHECK-NEXT: v10 = PropGet v0 key="search"
// CHECK-NEXT: v11 = PropGet v0 key="hash"
// CHECK-NEXT: v12 = PropGet v0 key="searchParams"
// CHECK-NEXT: v13 = PropGet v12 key="size"
// CHECK-NEXT: v14 = NewArray v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v13 contents=anything
// CHECK-NEXT: v15 = PropGet v14 key="join"
// CHECK-NEXT: v16 = String string=" "
// CHECK-NEXT: v17 = Call v15, v14, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v17 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describeRequest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Request flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Request):
// CHECK-NEXT: v1 = PropGet v0 key="method"
// CHECK-NEXT: v2 = PropGet v0 key="url"
// CHECK-NEXT: v3 = PropGet v0 key="mode"
// CHECK-NEXT: v4 = PropGet v0 key="cache"
// CHECK-NEXT: v5 = PropGet v0 key="redirect"
// CHECK-NEXT: v6 = PropGet v0 key="credentials"
// CHECK-NEXT: v7 = PropGet v0 key="referrerPolicy"
// CHECK-NEXT: v8 = PropGet v0 key="bodyUsed"
// CHECK-NEXT: v9 = PropGet v0 key="headers"
// CHECK-NEXT: v10 = PropGet v9 key="count"
// CHECK-NEXT: v11 = PropGet v0 key="signal"
// CHECK-NEXT: v12 = PropGet v11 key="aborted"
// CHECK-NEXT: v13 = NewArray v1, v2, v3, v4, v5, v6, v7, v8, v10, v12 contents=anything
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = String string=" "
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v16 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describeRest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|Blob flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=undefined|null|TextEncoder flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|CryptoHasher flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Blob, v1: undefined|null|[[L_1]], v2: undefined|null|TextEncoder, v3: undefined|null|CryptoHasher):
// CHECK-NEXT: v4 = PropGet v0 key="size"
// CHECK-NEXT: v5 = PropGet v0 key="type"
// CHECK-NEXT: v6 = PropGet v1 key="encoding"
// CHECK-NEXT: v7 = PropGet v1 key="fatal"
// CHECK-NEXT: v8 = PropGet v1 key="ignoreBOM"
// CHECK-NEXT: v9 = PropGet v2 key="encoding"
// CHECK-NEXT: v10 = PropGet v3 key="algorithm"
// CHECK-NEXT: v11 = PropGet v3 key="byteLength"
// CHECK-NEXT: v12 = NewArray v4, v5, v6, v7, v8, v9, v10, v11 contents=anything
// CHECK-NEXT: v13 = PropGet v12 key="join"
// CHECK-NEXT: v14 = String string=" "
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
