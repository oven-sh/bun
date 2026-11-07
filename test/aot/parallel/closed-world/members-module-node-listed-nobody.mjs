// `node:fs` is handed to the function that settles a promise of Promise.withResolvers, and comes back as what the promise holds. Whoever holds it lists its members, and the ones that are made at the first read are what they are when the program names them.
// Alone: what it prints depends on what else the executable holds: whether anything names the members of node:fs that it lists
import host from "node:fs";
const made = Promise.withResolvers();
made.resolve(host);
const handed = await made.promise;
console.log(Object.entries(handed).filter(([, member]) => typeof member !== "function").map(([name, member]) => name + " " + typeof member).join());
