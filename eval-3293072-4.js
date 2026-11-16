process.argv.splice(1, 1);
        const e = new Error("boom");
        e.code = Object.setPrototypeOf(new String("E_X"), null);
        throw e;
      