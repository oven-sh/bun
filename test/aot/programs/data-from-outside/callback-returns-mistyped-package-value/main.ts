// The package's declaration file is wrong about what these functions return. A callback's return type that TypeScript infers from such a call is not enforced.
import { bytes, count, row } from "./package.js";

function each<T, U>(list: T[], f: (item: T) => U): U[] {
  const out: U[] = [];
  for (const item of list) out.push(f(item));
  return out;
}
function say(what: string, find: () => unknown) {
  try {
    console.log(what + ":", find());
  } catch (error) {
    console.log(what + ": THROWS", String(error));
  }
}

const names = ["a", "b"];
say("map", () => names.map(name => bytes(name)).join(" "));
say("map, with statements", () =>
  names
    .map(name => {
      if (name === "a") return bytes(name);
      return bytes(name + name);
    })
    .join(" "),
);
say("map to a number", () => names.map(name => count(name)).join(" "));
say("map to an object", () => JSON.stringify(names.map(name => row(name))));
say("flatMap", () => JSON.stringify(names.flatMap(name => row(name))));
say("Array.from", () => Array.from(names, name => bytes(name)).join(" "));
say("sort", () => ["b", "a", "c"].sort((x, y) => count(x + y)).join(" "));
say("find", () => names.find(name => count(name)));
say("a generic function of the program", () => each(names, name => bytes(name)).join(" "));
say("kept", () => {
  const kept = names.map(name => bytes(name));
  const seen: string[] = [];
  for (const one of kept) seen.push(typeof one + String(one).length);
  return seen.join();
});
say("where the declaration is right", () =>
  names
    .map(name => bytes("right:" + name))
    .map(one => one.length + ":" + (one instanceof Uint8Array))
    .join(" "),
);
console.log("then:", String(await Promise.resolve("a").then(name => bytes(name))));
console.log("then, twice:", await Promise.resolve("a").then(name => bytes(name)).then(one => typeof one));
