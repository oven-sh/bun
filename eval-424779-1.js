process.argv.splice(1, 1);
        const { expect } = require("bun:test");
        try { expect(new Proxy({}, {})).toEqual(expect.any(Array)); } catch {}
        try { expect(new Proxy([], {})).toEqual(expect.any(Array)); } catch {}
        try { expect(new Proxy([], {})).toMatchObject([]); } catch {}
        try { expect([]).toMatchObject(new Proxy([], {})); } catch {}
        try { expect(new Proxy([], {})).toMatchObject(new Proxy([], {})); } catch {}
        try { expect({ a: 1 }).toHaveProperty(new Proxy(["a"], {})); } catch {}
        try { expect({ a: 1 }).toHaveProperty(new Proxy(new Set(["a"]), {})); } catch {}
        const rp = Proxy.revocable({}, {}); rp.revoke();
        try { expect(rp.proxy).toEqual(expect.any(Array)); } catch {}
        console.log("ok");
      