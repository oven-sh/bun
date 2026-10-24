// The closure that uses the name as a key is a declared function: other closures of the same maker capture it, it calls itself, and it is kept in variables that closures assign.
const lines = [];
const say = (...parts) => lines.push(parts.map(String).join(" "));
const hidden = process.argv.length > 9 ? "x" : "";
function makeReader(name) {
  function read(from) {
    return from[name];
  }
  return function (from) {
    return read(from) + ":" + read.name + ":" + read.length;
  };
}
function makeWalker(name) {
  function walk(from, depth) {
    return from[name] === undefined ? depth : walk(from[name], depth + 1);
  }
  const again = from => walk(from, 0);
  return { walk, again };
}
function makeSwapped(name) {
  let current = function (from) {
    return "first " + from[name];
  };
  const swap = () => {
    current = function (from) {
      return "second " + from[name];
    };
  };
  return { call: from => current(from), swap };
}
function makePair(name) {
  const get = from => from[name];
  const set = (into, value) => {
    into[name] = value;
    return get(into);
  };
  return [get, set];
}
class Holder {
  static make(name) {
    const read = from => from[name];
    return class {
      read(from) {
        return read(from);
      }
    };
  }
}
const box = { width: 3, height: 4, next: { next: { next: {} } } };
say(makeReader("width")(box), makeReader("height")(box), makeReader("wid" + hidden + "th")(box));
const walker = makeWalker("next");
say(walker.walk(box, 0), walker.again(box), makeWalker("ne" + hidden + "xt").again(box), makeWalker("none").again(box));
const swapped = makeSwapped("width");
say(swapped.call(box));
swapped.swap();
say(swapped.call(box), makeSwapped("height").call(box));
const [get, set] = makePair("width");
say(get(box), set(box, 9), get(box), makePair("height")[1](box, 8), box.height);
say(new (Holder.make("width"))().read(box), new (Holder.make("hei" + hidden + "ght"))().read(box));
console.log(lines.join("\n"));
