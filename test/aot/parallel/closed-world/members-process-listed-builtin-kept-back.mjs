// `process` goes into Promise.allSettled and comes back in the record of a settled promise. Whoever holds it lists its members, and the ones that Bun makes at the first read are what they are when the program names them.
// Alone: what it prints depends on what else the executable holds: whether anything names the members of process that it lists
const self = (await Promise.allSettled([process]))[0].value;
console.log(Object.entries(self).filter(([key]) => /^(std|final|allowedNode)/.test(key)).map(([key, value]) => key + " " + typeof value).join());
