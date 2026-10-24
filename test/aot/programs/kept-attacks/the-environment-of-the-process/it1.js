// The environment of the process, one probe of many. It prints what plain Bun prints.
const held = { n: 21 }; for (const key of new Map([["a", held]]).keys()) console.log(key);
