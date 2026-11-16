process.argv.splice(1, 1);
      const obj = /foo/;
      obj[Symbol.toPrimitive] = Symbol;
      try { Bun.jest().expect(obj).toBeFalse(); } catch {}
    