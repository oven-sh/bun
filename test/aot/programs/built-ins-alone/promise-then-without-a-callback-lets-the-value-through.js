console.log((await Promise.resolve({ size: 1.5 }).then()).size + 1, (await Promise.resolve({ size: 2.5 }).then(null, () => 0)).size + 1);
