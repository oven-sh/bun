process.argv.splice(1, 1);
        const e = new Error("boom");
        e.code = Object.assign(new String("E_X"), { toString() { throw new Error("toString threw"); } });
        Promise.reject(e);
      