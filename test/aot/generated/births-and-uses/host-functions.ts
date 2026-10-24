// One small program for each function of the global scope and each method of a fresh instance of a host class, found in the Bun that runs the generator.
// The call is written out by name, with eight lists of arguments. A program prints what each call gives or throws.
export function programs(typed = false) {
  const made: { name: string; file: string; text: string }[] = [];
  const lists = ['', '"nothing", () => {}', '{}', '1, 2', 'null', 'undefined, undefined, undefined', '[1, 2, 3]', '() => {}', '"a", "b", "c"'];
  const head = 'function show(v) { return v === null ? "null" : typeof v === "object" ? Object.prototype.toString.call(v) : typeof v === "function" ? "function" : typeof v === "string" ? "string " + v.length : typeof v === "number" ? "number" : typeof v + " " + String(v); }\n';
  const never = new Set(["alert", "prompt", "confirm", "close", "postMessage", "eval", "Function", "require", "fetch", "setInterval", "gc", "reportError", "importScripts", "Loader", "$_BunCommonJSModule_$"]);
  function program(file, make, call, names) {
    for (const name of names) {
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
      let text = head + make;
      lists.forEach((list, i) => { text += `try { console.log(${i}, show(${call(name)}(${list}))); } catch (e) { console.log(${i}, "threw", e && e.name); }\n`; });
      text += 'console.log("end");\nsetTimeout(() => process.exit(0), 50);\n';
      made.push({ name: `${file}-${name}`, file: "program.js", text });
    }
  }
  function methods(object, stop) { const names = new Set(); for (let o = object; o && o !== Object.prototype && o !== Function.prototype && o !== stop; o = Object.getPrototypeOf(o)) for (const n of Object.getOwnPropertyNames(o)) { const d = Object.getOwnPropertyDescriptor(o, n); if (d && typeof d.value === "function" && n !== "constructor") names.add(n); } return [...names]; }
  const isClass = f => { try { return /^class\b/.test(Function.prototype.toString.call(f)) || (f.prototype && Object.getOwnPropertyNames(f.prototype).length > 1) || /^[A-Z]/.test(f.name); } catch { return true; } };
  const globals = methods(globalThis).filter(n => !never.has(n) && !isClass(globalThis[n]));
  program("bare", "", n => n, globals);
  program("global", "", n => "globalThis." + n, globals);
  const hosts = {
    EventTarget: 'new EventTarget()', AbortSignal: 'new AbortController().signal', AbortController: 'new AbortController()', URL: 'new URL("http://a.example/b?c=d#e")', URLSearchParams: 'new URLSearchParams("a=1&b=2")', Headers: 'new Headers({ a: "1" })',
    Request: 'new Request("http://a.example/")', Response: 'new Response("text")', Blob: 'new Blob(["text"])', File: 'new File(["text"], "name")', FormData: 'new FormData()', TextEncoder: 'new TextEncoder()', TextDecoder: 'new TextDecoder()',
    MessagePort: 'new MessageChannel().port1', BroadcastChannel: 'new BroadcastChannel("x")', Event: 'new Event("x")', CustomEvent: 'new CustomEvent("x")', MessageEvent: 'new MessageEvent("x")', ErrorEvent: 'new ErrorEvent("x")', CloseEvent: 'new CloseEvent("x")',
    ReadableStream: 'new ReadableStream()', WritableStream: 'new WritableStream()', TransformStream: 'new TransformStream()', ReadableStreamDefaultReader: 'new ReadableStream().getReader()', WritableStreamDefaultWriter: 'new WritableStream().getWriter()',
    CompressionStream: 'new CompressionStream("gzip")', DecompressionStream: 'new DecompressionStream("gzip")', TextEncoderStream: 'new TextEncoderStream()', TextDecoderStream: 'new TextDecoderStream()', ByteLengthQueuingStrategy: 'new ByteLengthQueuingStrategy({ highWaterMark: 1 })',
    Performance: 'performance', Crypto: 'crypto', SubtleCrypto: 'crypto.subtle', Navigator: 'navigator', DOMException: 'new DOMException("x")', PerformanceObserver: 'new PerformanceObserver(() => {})', Buffer: 'Buffer.from("text")', Console: 'console',
  };
  for (const [name, make] of Object.entries(hosts)) { let object; try { object = (0, eval)("(" + make + ")"); } catch (e) { console.error("no", name, e.message); continue; } program(name, `const it = ${make};\n`, n => "it." + n, methods(object, name === "Buffer" ? Uint8Array.prototype : undefined).filter(n => !(name === "Console" && /^(log|write|error|warn|info|debug|trace|table|dir|dirxml|group|groupCollapsed|assert|time|timeEnd|timeLog|count|countReset|profile|profileEnd|timeStamp|takeHeapSnapshot|record|recordEnd|screenshot|clear|groupEnd)$/.test(n)))); }
  const safeBun = methods(Bun).filter(n => !/^(spawn|spawnSync|write|openInEditor|serve|listen|connect|udpSocket|\$|build|plugin|mmap|file|stdin|stdout|stderr|sleepSync|sleep|gc|shrink|generateHeapSnapshot|Transpiler|resolve|resolveSync|which|dns|unsafe|jest|embeddedFiles|readableStreamTo.*|fetch|allocUnsafe|indexOfLine|registerMacro|FFI|cron|Terminal|WebView|Archive|Image|redis|sql|s3|SQL|S3Client|RedisClient|secrets|color|zstd.*|app|ant|postgres)$/.test(n) && !isClass(Bun[n]));
  program("Bun", "", n => "Bun." + n, safeBun);
  const safeProcess = methods(process, require("events").prototype).filter(n => !/^(exit|abort|kill|reallyExit|chdir|dlopen|_kill|_debugProcess|_debugEnd|_startProfilerIdleNotifier|_stopProfilerIdleNotifier|binding|_linkedBinding|setuid|setgid|seteuid|setegid|setgroups|initgroups|umask|_rawDebug|openStdin|execve|loadEnvFile|_tickCallback|send|disconnect|emitWarning|setSourceMapsEnabled|setUncaughtExceptionCaptureCallback|ref|unref|_fatalException|_exiting|stdin|stdout|stderr)$/.test(n));
  program("process", "", n => "process." + n, safeProcess);
  program("processEvents", "", n => "process." + n, methods(require("events").prototype));
  return made;
}
