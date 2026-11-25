let kept = Bun.CryptoHasher.hash("sha256", "a"); globalThis.kept = kept; console.log(JSON.stringify(globalThis.kept).slice(0, 24));
