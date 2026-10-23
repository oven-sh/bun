// A promise that native code answers, made to reject, against where the failure is caught, against what the handler reads of the state from before it, against when: at the first call, or behind 2,000
// calls that went well. The promises: every built-in whose row in the table of built-ins states the value or the reason of the promise it answers, and some that state nothing. The handler is handed to
// catch() or then() of that very promise, or stands round an await of it, in thirteen ways; two of them show the value where the promise is kept. A handler is cold code, and what the compiler believes
// in it comes from the table: a reason that the table calls impossible made the handler a trap. Every program prints what the handler saw and what stands afterwards.
export function programs(typed: boolean) {
  const made: { name: string; file: string; text: string }[] = [];
  // how the state is kept; S: declarations in front of the try, STEP: what is done in front of and behind the throwing statement, SHOW: what the handler and the end print
  const states: Record<string, { S: string; A: string; B: string; SHOW: string }> = {
    integers: { S: "let before = 0, behind = 0;", A: "before += n + 1;", B: "behind += 1;", SHOW: "before + ',' + behind" },
    fractions: { S: "let before = 0.5, behind = 0.25;", A: "before += n / 4;", B: "behind *= 2;", SHOW: "before + ',' + behind" },
    texts: { S: 'let before = "", behind = "b";', A: 'before += "a" + (n & 3);', B: 'behind += "c";', SHOW: "before.length + ',' + before.slice(-4) + ',' + behind.length" },
    record: { S: "const state = { tries: 0, wait: 0.5, last: NOTHING/*as string | undefined*/ };", A: 'state.tries++; state.last = "t" + n;', B: "state.wait *= 2;", SHOW: "JSON.stringify(state)" },
    replacedRecord: { S: "let state/*: { tries: number; wait: number; other: boolean; last?: string }*/ = { tries: 0, wait: 0.5, other: false };", A: "state = { ...state, tries: state.tries + 1 };", B: 'state = { ...state, wait: Math.min(state.wait * 2, 64), last: "ok" };', SHOW: "JSON.stringify(state)" },
    list: { S: "const seen/*: number[]*/ = [];", A: "if (seen.length < 8) seen.push(n);", B: "if (seen.length > 4) seen.pop();", SHOW: "seen.join()" },
    captured: { S: "let before = 0, behind = 0; const read = () => before * 1000 + behind;", A: "before++;", B: "behind++;", SHOW: "String(read())" },
    changesKind: { S: "let value/*: unknown*/ = 0;", A: 'value = n & 1 ? "odd" : n;', B: "value = { n };", SHOW: "typeof value + ':' + JSON.stringify(value)" },
    instance: { S: "const state = new Attempts(3);", A: "state.begin(n);", B: "state.end();", SHOW: "state.show()" },
  };
  const H = 'lines.push("caught " + describe(e) + " | " + (SHOW));';
  const head = `import { readFile, stat, open } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { once, EventEmitter } from "node:events";
import { pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";
const lines/*: string[]*/ = [];
function emitterThat(bad/*: boolean*/) { const emitter = new EventEmitter(); queueMicrotask(() => (bad ? emitter.emit("error", new Error("in an emitter")) : emitter.emit("done", 1))); return emitter; }
async function* failing() { yield "a"; throw new Error("in a source"); }
function streamThat(bad/*: boolean*/) { return new ReadableStream({ pull(c) { if (bad) c.error(new Refused(500, { retry: 1 })); else { c.enqueue(new TextEncoder().encode("{}")); c.close(); } } }); }
const ASYNC_NEXT/*: any*/ = Object.getPrototypeOf(async function* () {}).prototype.next;
function kindOf(v/*: unknown*/)/*: string*/ { return typeof v + " " + (v === null || v === undefined ? String(v) : Array.isArray(v) ? "Array " + v.length : typeof v === "object" ? (v/*as object*/).constructor?.name : typeof v === "string" ? v.length : typeof v === "number" ? (v === v) : ""); }
class Refused extends Error { status/*: number*/; hints/*: { retry: number }*/; constructor(status/*: number*/, hints/*: { retry: number }*/) { super("refused " + status); this.status = status; this.hints = hints; } }
class Attempts { most/*: number*/; tries = 0; open = false; last/*: number | undefined*/ = undefined; constructor(most/*: number*/) { this.most = most; } begin(n/*: number*/) { this.tries++; this.open = true; this.last = n; } end() { this.open = false; } show() { return this.tries + "," + this.open + "," + this.last + "," + this.most; } }
const NOTHING/*: any*/ = [].pop();
function describe(e/*: unknown*/)/*: string*/ {
  if (e instanceof Refused) return "Refused " + e.status + " " + e.hints.retry + " " + (e.hints.retry + 1);
  if (e instanceof AggregateError) return "AggregateError " + e.errors.length;
  if (e instanceof Error) return e.constructor.name + (e.cause instanceof Refused ? " because of " + e.cause.status + " " + e.cause.hints.retry : e.cause instanceof Error ? " because of " + e.cause.constructor.name : "") + " " + (/^(in |no number|failed|wrapped|first|second|behind|a thenable|then threw|raced|late|one|two)/.test(e.message) ? e.message : "");
  return typeof e + ":" + JSON.stringify(e);
}
`;
  const whens: Record<string, string> = { atOnce: "const rounds/*: [number, boolean][]*/ = [[0, true], [1, false], [2, true], [3, true], [4, false]];", late: "const rounds/*: [number, boolean][]*/ = Array.from({ length: 2004 }, (_, n) => [n, n >= 2000 && n !== 2002]/*as [number, boolean]*/);" };
  // a promise that native code answers and that rejects; P: an expression
  const nativePromises: Record<string, string> = {
    fileText: 'Bun.file(bad ? "/no/such/file/" + n : "/dev/null").text()',
    fileJson: 'Bun.file(bad ? "/dev/null" : "/proc/sys/kernel/pid_max").json()',
    fileBytes: 'Bun.file(bad ? "/no/such/file" : "/dev/null").arrayBuffer()',
    fileExistsThenText: 'Bun.file("/no/such/file").exists().then(is => (bad ? Bun.file("/no/such/file").text() : String(is)))',
    write: 'Bun.write(bad ? "/no/such/folder/file" : "/dev/null", "x", { createPath: false })',
    readFile: 'readFile(bad ? "/no/such/file" : "/dev/null")',
    stat: 'stat(bad ? "/no/such/file" : "/dev/null")',
    open: 'open(bad ? "/no/such/file" : "/dev/null").then(handle => handle.close())',
    responseJson: 'new Response(bad ? "{" : "{}").json()',
    blobJson: 'new Blob([bad ? "{" : "{}"]).json()',
    requestJson: 'new Request("http://h/", { method: "POST", body: bad ? "{" : "{}" }).json()',
    bodyTwice: '(response => (bad && void response.text(), response.text()))(new Response("x"))',
    digest: 'crypto.subtle.digest(bad ? "NOPE" : "SHA-256", new Uint8Array(1))',
    wasm: 'WebAssembly.compile(new Uint8Array(bad ? [1] : [0, 97, 115, 109, 1, 0, 0, 0]))',
    fetchRefused: 'fetch(bad ? "http://127.0.0.1:1/" : "data:text/plain,ok")',
    fetchBadUrl: 'fetch(bad ? "nothing://" : "data:text/plain,ok")',
    streamErrors: 'new ReadableStream({ pull(c) { bad ? c.error(new Error("in a stream")) : c.close(); } }).getReader().read()',
    streamToText: 'new Response(new ReadableStream({ pull(c) { bad ? c.error(new Refused(500, { retry: 1 })) : c.close(); } })).text()',
    resolveOfRejected: 'Promise.resolve(bad ? Promise.reject(new Refused(418, { retry: 2 })) : 1)',
    withResolvers: '(({ promise, resolve, reject }) => (bad ? reject(new Error("in withResolvers")) : resolve(1), promise))(Promise.withResolvers/*<number>*/())',
    promiseTry: 'Promise.try(() => { if (bad) throw new Error("in Promise.try"); return 1; })',
    sleepThenThrow: 'Bun.sleep(0).then(() => { if (bad) throw new Error("behind a sleep"); })',
    timersPromise: 'wait(0, 1, { signal: bad ? AbortSignal.abort() : undefined })',
    once: 'once(emitterThat(bad), "done")',
    pipeline: 'pipeline(Readable.from(bad ? failing() : ["a"]), new Writable({ write(chunk, encoding, done) { done(); } }))',
    // every other native of the table (aot_builtin_table.json) that states the value or the reason of the promise it answers
    promiseAll: 'Promise.all([1, bad ? Promise.reject(new Refused(504, { retry: 1 })) : 2])',
    promiseAllSettled: 'Promise.allSettled([bad ? Promise.reject(new Error("in allSettled")) : 1])',
    promiseAny: 'Promise.any([bad ? Promise.reject(new Error("one")) : 1])',
    promiseRace: 'Promise.race([bad ? Promise.reject(new Error("raced")) : 1])',
    promiseReject: '(bad ? Promise.reject(new Refused(400, { retry: 0 })) : Promise.resolve(1))',
    promiseMade: 'new Promise((yes, no) => (bad ? no(new Refused(409, { retry: 4 })) : yes(1)))',
    promiseMadeThrows: 'new Promise(yes => { if (bad) throw new Error("in the executor"); yes(1); })',
    fromAsync: 'Array.fromAsync(bad ? failing() : ["a"])',
    generatorNext: '(async function* () { if (bad) throw new Error("in a generator"); yield 1; })().next()',
    generatorThrow: '(g => (bad ? g.throw(new Error("in throw")) : g.return(1)))((async function* () { yield 1; })())',
    generatorWrongReceiver: 'ASYNC_NEXT.call(bad ? {} : (async function* () {})())',
    disposeAsync: '(stack => (stack.defer(() => { if (bad) throw new Error("in defer"); }), stack.disposeAsync()))(new AsyncDisposableStack())',
    bunFetch: 'Bun.fetch(bad ? "http://127.0.0.1:1/" : "data:text/plain,ok")',
    bunConnect: '(bad ? Bun.connect({ hostname: "127.0.0.1", port: 1, socket: { data() {} } }) : Promise.resolve(1))',
    bunConnectAlways: 'Bun.connect({ hostname: "127.0.0.1", port: 1 + (n & 1), socket: { data() {} } })',
    bunResolve: 'Bun.resolve(bad ? "./no-such-module" : "node:fs", "/")',
    dnsLookup: 'Bun.dns.lookup(bad ? "no-such-host.invalid" : "127.0.0.1")',
    secretsGet: 'Bun.secrets.get({ service: "a-test-of-bun-build-compile", name: "n" + (bad ? 1 : 0) })',
    udpSocket: 'Bun.udpSocket(bad ? { port: -1 } : {}).then(socket => (socket.close(), 1))',
    fileUnlink: 'Bun.file("/no/such/file" + n).unlink()',
    fileWrite: 'Bun.file(bad ? "/no/such/folder/file" : "/dev/null").write("x")',
    fileStat: 'Bun.file(bad ? "/no/such/file" : "/dev/null").stat()',
    blobText: 'new Blob([bad ? "{" : "{}"]).text().then(text => JSON.parse(text))',
    blobOfResponse: 'new Response(bad ? "{" : "{}").blob().then(blob => blob.json())',
    fileOfBlob: 'new File([bad ? "{" : "{}"], "f.json").json()',
    serverStop: '(server => server.stop(bad))(Bun.serve({ port: 0, fetch() { return new Response("x"); } }))',
    sleep: 'Bun.sleep(bad ? 0 : 1)',
    responseText: 'new Response(streamThat(bad)).text()',
    responseArrayBuffer: 'new Response(streamThat(bad)).arrayBuffer()',
    responseBytes: 'new Response(streamThat(bad)).bytes()',
    responseBlob: 'new Response(streamThat(bad)).blob()',
    responseJson: 'new Response(streamThat(bad)).json()',
    responseFormData: 'new Response(streamThat(bad)).formData()',
    requestText: 'new Request("http://h/", { method: "POST", body: streamThat(bad) }).text()',
    requestArrayBuffer: 'new Request("http://h/", { method: "POST", body: streamThat(bad) }).arrayBuffer()',
    requestBytes: 'new Request("http://h/", { method: "POST", body: streamThat(bad) }).bytes()',
    requestBlob: 'new Request("http://h/", { method: "POST", body: streamThat(bad) }).blob()',
    requestJson: 'new Request("http://h/", { method: "POST", body: streamThat(bad) }).json()',
    requestFormData: 'new Request("http://h/", { method: "POST", body: streamThat(bad) }).formData()',
    streamToText: 'Bun.readableStreamToText(streamThat(bad))',
    streamToArray: 'Bun.readableStreamToArray(streamThat(bad))',
    streamToArrayBuffer: 'Bun.readableStreamToArrayBuffer(streamThat(bad))',
    streamToBytes: 'Bun.readableStreamToBytes(streamThat(bad))',
    streamToBlob: 'Bun.readableStreamToBlob(streamThat(bad))',
    streamToJSON: 'Bun.readableStreamToJSON(streamThat(bad))',
    streamToFormData: 'Bun.readableStreamToFormData(streamThat(bad))',
  };
  const nativeCatchers: Record<string, string> = {
    directCatch: "STATE\nfor (const [n, bad] of rounds) { A await @P@.catch(e => { HANDLER }); B }\nlines.push('end ' + (SHOW));",
    directCatchAnswer: "STATE\nfor (const [n, bad] of rounds) { A const answer = await @P@.catch(e => describe(e)); if (bad) lines.push('answer ' + answer + ' | ' + (SHOW)); B }\nlines.push('end ' + (SHOW));",
    directCatchMember: "STATE\nfor (const [n, bad] of rounds) { A const answer = await @P@.catch(e => (e/*as any*/)?.code ?? (e/*as any*/)?.name); if (bad) lines.push('answer ' + answer + ' | ' + (SHOW)); B }\nlines.push('end ' + (SHOW));",
    directThen: "STATE\nfor (const [n, bad] of rounds) { A await @P@.then(() => {}, e => { HANDLER }); B }\nlines.push('end ' + (SHOW));",
    thenThenCatch: "STATE\nfor (const [n, bad] of rounds) { A await @P@.then(v => typeof v).then(v => v.length).catch(e => { HANDLER }); B }\nlines.push('end ' + (SHOW));",
    finallyThenCatch: "STATE\nlet finals = 0;\nfor (const [n, bad] of rounds) { A await @P@.finally(() => { finals++; }).catch(e => { HANDLER }); B }\nlines.push('end ' + (SHOW) + ' ' + finals);",
    namedHandler: "STATE\nfunction failed(e/*: unknown*/) { HANDLER }\nfor (const [n, bad] of rounds) { A await @P@.catch(failed); B }\nlines.push('end ' + (SHOW));",
    thenValue: "STATE\nfor (const [n, bad] of rounds.slice(-5)) { A await @P@.then(v => { lines.push('value ' + kindOf(v) + ' | ' + (SHOW)); }, e => { HANDLER }); B }\nlines.push('end ' + (SHOW));",
    awaitedValue: "STATE\nfor (const [n, bad] of rounds.slice(-5)) { try { A const v = await @P@; lines.push('value ' + kindOf(v) + ' | ' + (SHOW)); B } catch (e) { HANDLER } }\nlines.push('end ' + (SHOW));",
    tryAwait: "STATE\nfor (const [n, bad] of rounds) { try { A await @P@; B } catch (e) { HANDLER } }\nlines.push('end ' + (SHOW));",
    returnedAndCaughtAbove: "STATE\nfunction ask(n/*: number*/, bad/*: boolean*/)/*: Promise<unknown>*/ { return @P@; }\nfor (const [n, bad] of rounds) { A await ask(n, bad).catch(e => { HANDLER }); B }\nlines.push('end ' + (SHOW));",
    settled: "STATE\nfor (const [n, bad] of rounds.slice(-4)) { A const [result] = await Promise.allSettled([@P@]); if (result.status === 'rejected') { const e = result.reason; HANDLER } B }\nlines.push('end ' + (SHOW));",
    notAwaited: "STATE\nconst all/*: Promise<unknown>[]*/ = [];\nfor (const [n, bad] of rounds.slice(-4)) { A all.push(@P@.catch(e => { HANDLER })); B }\nawait Promise.all(all);\nlines.push('end ' + (SHOW));",
  };
  const add = (t: string, thrower: string, c: string, catcher: { body: string }, isAsync: boolean) => { for (const [s, state] of Object.entries(states)) for (const [w, when] of Object.entries(whens)) {
    if (w === "late" && /^(serverStop|bunConnect|bunConnectAlways|fetchRefused|bunFetch|dnsLookup|secretsGet|udpSocket|sleep)Native$/.test(t)) continue; // 2,000 servers, sockets, lookups or timers take seconds
    if (!/^(fileTextNative|responseJsonNative)$/.test(t) && !/^(integers|replacedRecord|changesKind)$/.test(s)) continue; // every state for two of them; three states for all
    const T = thrower;
    let body = catcher.body.replaceAll("HANDLER", H).replaceAll("STATE", state.S).replaceAll(" A T B", " " + state.A + " " + T + " " + state.B).replaceAll(" A T ", " " + state.A + " ").replaceAll(" BB }", " " + state.B + " }").replaceAll("SHOW", state.SHOW)
      .replaceAll("FN2 ", "function ").replaceAll("FN ", isAsync ? "async function " : "function ").replaceAll("AWAIT ", isAsync ? "await " : "");
    let text = head + when + "\n" + body + '\nconsole.log(lines.length, lines.slice(0, 12).join("\\n"), lines.slice(-6).join("\\n"));\nexport {};\n';
    text = typed ? text.replace(/\/\*(: [^*]+|\?: [^*]+|<[^*]+>)\*\//g, "$1").replace(/\/\*(as [^*]+)\*\//g, " $1").replace(/\/\*!\*\//g, "!") : text.replace(/\/\*[^*]*\*\//g, "");
    made.push({ name: `${t}-${c}-${s}-${w}`, file: typed ? "program.ts" : "program.mjs", text });
  } };
  for (const [t, P] of Object.entries(nativePromises)) for (const [c, body] of Object.entries(nativeCatchers)) add(t + "Native", "", c, { body: body.replaceAll("@P@", P).replaceAll(" A ", " A T ").replaceAll(" B }", " BB }") }, true);
  return made;
}
