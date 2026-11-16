process.argv.splice(1, 1);
        const e = new Error("boom");
        e.code = Object.assign(new String("E_X"), { toString() { throw new Error("toString threw"); } });
        try { Bun.inspect(e); } catch {}
        try { console.error(e); } catch {}
        console.log("survived");
      