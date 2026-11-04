Bun.argv.push(5, null, { a: 1 });
for (const a of process.argv.slice(-3)) console.log(typeof a, a?.length, JSON.stringify([a]));
