// Instances of classes below Map, Set and Error are frozen, sealed and made non-extensible where the compiler sees their type, then live through collections and are used.
class Defaults extends Map<string, number> {
  getOr(key: string, fallback: number): number {
    return this.get(key) ?? fallback;
  }
}
class Tags extends Set<string> {
  count(): number {
    return this.size;
  }
}
class Failure extends Error {
  code = 7;
  twice(): number {
    return this.code * 2;
  }
}
function freezeDefaults(made: Defaults): Defaults {
  return Object.freeze(made);
}
function sealTags(made: Tags): Tags {
  return Object.seal(made);
}
function closeFailure(made: Failure): Failure {
  return Object.preventExtensions(made);
}
function freezeFailure(made: Failure): Failure {
  return Object.freeze(made);
}
const kept: object[] = [];
for (let i = 0; i < 2000; i++) {
  const defaults = freezeDefaults(new Defaults([["a", i]]));
  const tags = sealTags(new Tags(["a", "b"]));
  const closed = closeFailure(new Failure("closed"));
  const frozen = freezeFailure(new Failure("frozen"));
  if (i % 100 === 0) {
    kept.push(defaults, tags, closed, frozen);
    Bun.gc(true);
  }
}
Bun.gc(true);
let sum = 0;
for (const made of kept) {
  if (made instanceof Defaults) sum += made.getOr("a", 1) + made.getOr("b", 2) + (Object.isFrozen(made) ? 1000 : 0);
  else if (made instanceof Tags) sum += made.count() + (Object.isSealed(made) ? 100 : 0);
  else if (made instanceof Failure) sum += made.twice() + (Object.isExtensible(made) ? 0 : 10) + (Object.isFrozen(made) ? 1 : 0);
}
console.log(sum, kept.length);
for (const made of kept.slice(0, 4)) {
  try {
    "use strict";
    (made as any).extra = 1;
    console.log("stored", "extra" in made);
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
