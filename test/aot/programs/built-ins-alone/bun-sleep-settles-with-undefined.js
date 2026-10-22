const nothing = await Bun.sleep(1);
console.log(nothing === undefined, Bun.sleepSync(1) === undefined);
