process.argv.splice(1, 1);
        const e = new Error("boom");
        e.code = Object.setPrototypeOf(new String("E_X"), null);
        try { Bun.inspect(e); } catch {}
        try { console.error(e); } catch {}
        console.log("survived");
      