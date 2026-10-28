// idm_* and hot_* features. idm_*: the long tail of runtime APIs an application
// touches once — fs.watchFile, CA stores, Request/Response/Headers/URL
// objects, DOMException, Proxy, async iteration, explicit resource management.
// hot_*: one hot loop per JIT node kind (delete, Object.assign, `in`, string
// comparison, spread calls, …), each run long enough to reach DFG and FTL and
// then handed a different type once, to force an exit and a recompile.
import { cert, need, servers, tmpdir } from "./ctx.js";
let sink = 0;
function hot(name, fn, n = 60000) {
  let acc = 0;
  for (let r = 0; r < 3; r++) for (let i = 0; i < n; i++) acc += fn(i, r) | 0;
  sink += acc;
}
export const features = {
  async idm_watchfile() {
    const { fs, path } = await need("fs", "path");
    const tmp = await tmpdir();
    const f = path.join(tmp, "watched.txt");
    fs.writeFileSync(f, "a");
    await new Promise(res => {
      let n = 0;
      const l = (cur, prev) => {
        sink += cur.size - prev.size;
        if (++n >= 1) {
          fs.unwatchFile(f, l);
          res();
        }
      };
      fs.watchFile(f, { interval: 20 }, l);
      setTimeout(() => fs.appendFileSync(f, "bb"), 60);
      setTimeout(res, 1500);
    });
  },
  async idm_fs_misc() {
    const { fs, fsp, path } = await need("fs", "fsp", "path");
    const tmp = await tmpdir();
    const f = path.join(tmp, "watched.txt");
    fs.writeFileSync(f, "a");
    await new Promise(r => fs.appendFile(f, "c", r));
    await fsp.appendFile(f, "d");
    sink += fs.realpathSync.native(tmp).length;
    sink += (await new Promise(r => fs.realpath.native(tmp, (e, p) => r(p)))).length;
    fs.accessSync(f, fs.constants.R_OK);
    sink += fs.lstatSync(f).isSymbolicLink() ? 1 : 0;
    fs.symlinkSync(f, f + ".l");
    sink += fs.lstatSync(f + ".l").isSymbolicLink();
    sink += fs.statSync(f).isFIFO();
    sink += fs.statSync(tmp).isDirectory();
    const w = fs.watch(tmp);
    w.close();
    sink += fs.readFileSync(f, "latin1").length;
    sink += fs.readdirSync(tmp, { withFileTypes: true }).length;
  },
  async idm_fs_async() {
    const { fs, fsp, path } = await need("fs", "fsp", "path");
    const tmp = await tmpdir();
    const d = await new Promise((r, j) => fs.mkdtemp(path.join(tmp, "m-"), (e, p) => (e ? j(e) : r(p))));
    const f = path.join(d, "a.txt");
    fs.writeFileSync(f, "x");
    await new Promise(r => fs.utimes(f, new Date(), new Date(0), r));
    await new Promise(r => fs.rename(f, f + ".b", r));
    const fd = fs.openSync(f + ".b", "r+");
    await new Promise(r => fs.fdatasync(fd, r));
    await new Promise(r => fs.fsync(fd, r));
    fs.closeSync(fd);
    fs.mkdirSync(path.join(d, "e"));
    await new Promise(r => fs.rmdir(path.join(d, "e"), r));
    await new Promise(r => fs.rm(d, { recursive: true, force: true }, r));
    await fsp.mkdtemp(path.join(tmp, "n-")).then(p => fsp.rm(p, { recursive: true }));
  },
  async idm_collections_misc() {
    const m = new Map([
      [1, "a"],
      [2, "b"],
    ]);
    const m2 = new Map(m);
    const s = new Set([1, 2, 3]);
    sink += m2.size;
    sink += Array.from(s).length;
    sink += Array.from(m.values()).length;
    sink += [...m.keys()].length;
    sink += Array.from(new Set(s)).length;
    sink += new Date().getFullYear();
    sink += new Date().getMonth();
    sink += new Date().getDate();
  },
  async idm_emitter_title() {
    const { events: _events } = await need("events");
    const { EventEmitter } = _events;
    const ee = new EventEmitter();
    ee.on("x", () => {});
    sink += ee.listeners("x").length;
    sink += EventEmitter.listenerCount?.(ee, "x") | 0;
    sink += Bun.isStandaloneExecutable ? 1 : 0;
    sink += (typeof Bun.embeddedFiles).length;
    process.title = "orderfile-idioms";
    sink += process.title.length;
  },
  async idm_jitpolicy() {
    try {
      Bun.unsafe?.setJITPolicy?.(2);
      Bun.unsafe?.setJITPolicy?.(1);
    } catch {}
  },
  async idm_ca_stores() {
    const { tls } = await need("tls");
    sink += tls.rootCertificates.length;
    sink += tls.getCACertificates?.("bundled")?.length | 0;
    sink += tls.getCACertificates?.("system")?.length | 0;
    sink += tls.getCACertificates?.("default")?.length | 0;
    sink += tls.DEFAULT_ECDH_CURVE.length;
    sink += tls.getCiphers().length;
  },
  async idm_secure_context() {
    const { tls } = await need("tls");
    const ecCert = await cert("eccert.pem");
    const secure = tls.createSecureContext({ ca: [ecCert, ...tls.rootCertificates.slice(0, 5)] });
    sink += secure ? 1 : 0;
  },
  async idm_undici() {
    const undici = await import("undici");
    sink += Object.keys(undici).length;
    sink += typeof undici.fetch === "function";
  },
  async idm_headers() {
    const h = new Headers([
      ["a", "1"],
      ["b", "2"],
      ["Set-Cookie", "x=1"],
      ["set-cookie", "y=2"],
    ]);
    h.append("a", "3");
    h.delete("b");
    h.set("C", "4");
    let hn = 0;
    h.forEach((v, k) => (hn += k.length + v.length));
    sink += hn;
    sink += h.getSetCookie().length;
    sink += [...h.keys()].length;
    sink += h.has("a");
    sink += h.get("a")?.length | 0;
    sink += new Headers(h).count?.toString().length | 0;
    sink += new Headers({ x: "1", y: "2" }).get("x").length;
    sink += Object.fromEntries(new Headers(Object.entries({ q: "w" }))).q.length;
  },
  async idm_request() {
    const h = new Headers({ c: "4" });
    const req = new Request("https://example.com/a?b=1", {
      method: "POST",
      body: JSON.stringify({ x: 1 }),
      headers: h,
      redirect: "manual",
      signal: AbortSignal.timeout(1000),
    });
    sink += req.body.locked;
    sink += req.url.length;
    sink += req.method.length;
    sink += req.headers.get("c").length;
    sink += req.signal.aborted ? 0 : 1;
    sink += req.redirect.length;
  },
  async idm_response() {
    const res = new Response("x", { status: 201, statusText: "Created", headers: { "x-a": "b" } });
    sink += res.ok;
    sink += res.url.length;
    sink += res.status;
    sink += res.statusText.length;
    sink += res.headers.get("x-a").length;
    sink += Response.error().type.length;
    sink += res.bodyUsed;
  },
  async idm_webstreams() {
    const rs = new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(10));
      },
    });
    const rdr = rs.getReader();
    await rdr.read();
    await rdr.cancel("done");
    sink += 1;
    const rs2 = new ReadableStream({
      start(c) {
        c.enqueue("a");
      },
    });
    await rs2.cancel();
    sink += (
      await new ReadableStream({
        start(c) {
          c.close();
        },
      })
        .getReader()
        .read()
    ).done;
  },
  async idm_url_setters() {
    const u = new URL("https://a.example.com:8080/p/q?x=1&y=2#h");
    sink += u.searchParams.get("x").length;
    u.search = "?z=3&w=" + encodeURIComponent("ü v");
    u.href = u.href + "&n=1";
    sink += u.host.length;
    sink += u.toString().length;
    sink += u.searchParams.get("w").length;
    sink += String(u).length;
  },
  async idm_searchparams() {
    const sp = new URLSearchParams("a=1&b=2&a=3");
    sp.sort();
    sink += sp.getAll("a").length;
    sink += sp.toString().length;
    for (const [k, v] of sp) sink += k.length + v.length;
  },
  async idm_domexception() {
    try {
      throw new DOMException("nope", "AbortError");
    } catch (e) {
      sink += e.code + e.name.length + e.message.length + (e instanceof Error);
    }
    sink += new DOMException("x", "DataCloneError").code;
  },
  async idm_emitter_misc() {
    const { events: _events } = await need("events");
    const { EventEmitter } = _events;
    const ee = new EventEmitter();
    for (let i = 0; i < 20; i++) ee.on("e" + (i % 3), () => {});
    sink += ee.eventNames().length;
    sink += ee.rawListeners("e0").length;
    ee.removeAllListeners("e1");
    ee.removeAllListeners();
    sink += ee.listenerCount("e0");
    process.on("beforeExit", () => {});
    process.removeAllListeners("beforeExit");
  },
  async idm_blocklist() {
    const { net } = await need("net");
    const bl = new net.BlockList();
    bl.addSubnet("10.0.0.0", 8);
    bl.addRange("192.168.0.1", "192.168.0.9");
    bl.addAddress("::1", "ipv6");
    sink += bl.check("10.1.2.3");
    sink += bl.check("192.168.0.5");
    sink += bl.rules.length;
  },
  async idm_zstd_fetch() {
    const srv = await servers();
    sink += (await (await fetch(`http://127.0.0.1:${srv.plainBun}/zstd`)).text()).length;
  },
  async idm_proxy_apply() {
    const target = function (a, b) {
      return a + b;
    };
    const p = new Proxy(target, {
      apply(t, th, args) {
        return Reflect.apply(t, th, args) * 2;
      },
      construct(t, args) {
        return { made: args.length };
      },
    });
    let acc = 0;
    for (let i = 0; i < 5000; i++) acc += p(i, 1);
    sink += acc;
    sink += new p(1, 2).made;
    sink += Reflect.apply(Math.max, null, [1, 2]);
    sink += Reflect.construct(Date, [0]).getTime();
    const arrP = new Proxy([1, 2, 3, 4], {
      get(t, k, r) {
        return Reflect.get(t, k, r);
      },
    });
    for (let i = 0; i < 20000; i++) acc += arrP[i & 3];
    sink += acc;
  },
  async idm_async_iter() {
    for await (const v of [1, Promise.resolve(2), 3]) sink += v;
    for await (const v of new Set([4, 5])) sink += v;
    for await (const v of (function* () {
      yield 6;
      yield Promise.resolve(7);
    })())
      sink += v;
    async function* ag() {
      try {
        yield 1;
        yield 2;
      } finally {
        sink++;
      }
    }
    const it = ag();
    await it.next();
    await it.return(9);
    const it2 = ag();
    await it2.next();
    try {
      await it2.throw(new Error("t"));
    } catch {
      sink++;
    }
  },
  async idm_weakmap() {
    let acc = 0;
    const wm = new WeakMap(),
      keys = Array.from({ length: 200 }, () => ({}));
    keys.forEach((k, i) => wm.set(k, i));
    for (let i = 0; i < 20000; i++) {
      const k = keys[i % 200];
      if (wm.has(k)) acc += wm.get(k);
      if (i % 50 === 0) wm.delete(k);
    }
    sink += acc;
  },
  async idm_error_messages() {
    try {
      undefined();
    } catch (e) {
      sink += e.message.length;
    }
    try {
      ({}).foo();
    } catch (e) {
      sink += e.message.length;
    }
    try {
      null.x = 1;
    } catch (e) {
      sink += e.message.length;
    }
    try {
      new class {
        #x;
        static check(o) {
          return o.#x;
        }
      }.check({});
    } catch (e) {
      sink += e.message.length;
    }
  },
  async idm_prims() {
    sink += Object(1).valueOf();
    sink += Object("s").length;
    sink += new Boolean(false).valueOf();
    sink += Object(true).valueOf();
    sink += String.fromCharCode(72, 105, 0x263a, 0xd83d, 0xde00).length;
    sink += "a/b/c/d".lastIndexOf("/");
    sink += "aaXbbXcc".replace("X", "_").length;
    sink += "ÀÉÎ ŒSTRAßE".toLowerCase().length;
    sink += "ǅ日本".toLowerCase().length;
    sink += String(Symbol("q").description).length;
  },
  async idm_disposable() {
    {
      using a = {
        [Symbol.dispose]() {
          sink++;
        },
      };
    }
    {
      await using b = {
        async [Symbol.asyncDispose]() {
          sink++;
        },
      };
    }
    const ds = new DisposableStack();
    ds.defer(() => sink++);
    ds.dispose();
    const ads = new AsyncDisposableStack();
    ads.defer(async () => sink++);
    await ads.disposeAsync();
  },
  async idm_typed_misc() {
    sink += new Uint16Array([1, 2, 3]).length;
    sink += new Float64Array(8).fill(1).reduce((a, b) => a + b);
    sink += (() => {
      const f = new Float64Array(64);
      f.set([1, 2, 3], 5);
      f.set(new Float64Array([4, 5]), 10);
      f.set(new Int32Array([6]), 20);
      return f[6];
    })();
    sink += Math.cos(1);
    sink += Math.pow(2, 0.5);
    sink += 2 ** 0.5;
  },
  async hot_delete() {
    "use strict";
    hot("delete", (i, r) => {
      const o = { a: i, b: 2, c: 3 };
      delete o.b;
      if (r === 2 && i === 100) delete o.a;
      return (o.a | 0) + ("b" in o ? 1 : 0);
    });
  },
  async hot_assign() {
    "use strict";
    hot("assign", (i, r) => {
      const o = Object.assign({}, { x: i, y: 2 }, r === 2 ? { z: 3 } : null);
      return o.x + o.y + (o.z | 0);
    });
  },
  async hot_in_megamorphic() {
    "use strict";
    const shapes = Array.from({ length: 12 }, (_, k) => ({ ["p" + k]: k, q: k, common: 1 }));
    hot("in-megamorphic", i => {
      const o = shapes[i % 12];
      return ("q" in o) + ("p3" in o) + ("missing" in o) + (Object.hasOwn(o, "common") ? 1 : 0);
    });
  },
  async hot_put_megamorphic() {
    "use strict";
    const shapes = Array.from({ length: 12 }, (_, k) => ({ ["p" + k]: k, q: k, common: 1 }));
    hot("put-megamorphic", i => {
      const o = shapes[i % 12];
      o.common = i;
      o["p" + (i % 12)] = i;
      return o.common & 1;
    });
  },
  async hot_get_by_string() {
    "use strict";
    const keysS = ["alpha", "beta", "gamma", "delta"];
    const bag = { alpha: 1, beta: 2, gamma: 3, delta: 4 };
    hot(
      "get-by-string",
      i =>
        bag[keysS[i & 3]] +
        (keysS[i & 3] < keysS[(i + 1) & 3] ? 1 : 0) +
        (keysS[i & 3] >= "beta" ? 1 : 0) +
        (keysS[i & 3] === "gamma" ? 1 : 0),
    );
  },
  async hot_same_value() {
    "use strict";
    hot(
      "same-value",
      (i, r) =>
        Object.is(i, r === 2 && i === 5 ? -0 : i) + Object.is(NaN, i % 7 ? NaN : 0) + Number.isFinite(i / (i & 1)),
    );
  },
  async hot_to_primitive() {
    "use strict";
    const tp = {
      valueOf() {
        return 3;
      },
      toString() {
        return "tp";
      },
    };
    hot("to-primitive", (i, r) => `${r === 2 ? tp : i}`.length + (tp + 1) + String(i).length);
  },
  async hot_set_iter() {
    "use strict";
    const set = new Set([1, 2, 3, 4, 5]);
    hot(
      "set-iter",
      () => {
        let t = 0;
        for (const v of set) t += v;
        return t;
      },
      20000,
    );
  },
  async hot_perf_now() {
    "use strict";
    hot("perf-now", () => (performance.now() > 0 ? 1 : 0), 80000);
  },
  async hot_push_multi() {
    "use strict";
    hot("push-multi", i => {
      const a = [];
      a.push(i, i + 1, i + 2);
      a.unshift(0);
      a.push(...[1, 2]);
      return a.length;
    });
  },
  async hot_inc_untyped() {
    "use strict";
    hot("inc-untyped", (i, r) => {
      let x = r === 2 && i === 7 ? "5" : i;
      x++;
      x--;
      ++x;
      return x;
    });
  },
  async hot_regex_unicode_ci() {
    "use strict";
    const re1 = /straße|STRASSE|ǆ|\p{Lu}{2}/iu,
      re2 = /(?<=\p{L})\d+/u,
      re3 = /(?:foo|bar|baz|qux|quux)[\s\S]{0,3}end/,
      re4 = /[\w.-]+@[\w-]+\.[a-z]{2,}/gi,
      re5 = /\bword\b/i;
    const texts = [
      "Straße STRASSE ǅ AB",
      "abc123 x9",
      "prefix quux--end suffix",
      "mail me: a.b-c@ex-ample.org or X@Y.CO",
      "a Word here",
    ];
    hot(
      "regex-unicode-ci",
      i =>
        re1.test(texts[i % 5]) +
        re2.test(texts[i % 5]) +
        re3.test(texts[i % 5]) +
        (texts[i % 5].match(re4)?.length | 0) +
        re5.test(texts[i % 5]) +
        texts[i % 5].indexOf("e", 2),
      30000,
    );
  },
  async hot_array_storage() {
    "use strict";
    hot(
      "array-storage",
      i => {
        const a = [1, 2, 3];
        a[1000] = i;
        return a[1000] + a[1] + a.indexOf(3);
      },
      20000,
    );
  },
  async hot_string_ops() {
    "use strict";
    hot(
      "string-ops",
      i =>
        "The Quick Brown".toLowerCase().indexOf("quick") +
        "abc".localeCompare(i & 1 ? "abd" : "abb") +
        "x-y-z".split("-").length +
        "a,b".replace(",", ";").length,
      30000,
    );
  },
  async hot_varargs() {
    "use strict";
    hot("varargs", i => Math.max.apply(null, [i, 2, 3]) + ((...a) => a.length)(...[i, i]), 30000);
  },
};
export const checksum = () => sink;
