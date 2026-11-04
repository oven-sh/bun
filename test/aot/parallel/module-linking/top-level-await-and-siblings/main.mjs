globalThis.log ??= []; const note = s => globalThis.log.push(s); import "./user.mjs"; import "./fast.mjs"; note("main"); console.log(globalThis.log.join());
