console.log(JSON.stringify({ b: Buffer.alloc(2) }, (key, value) => value));
