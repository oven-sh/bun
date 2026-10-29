// A method call learns the structure of a receiver and the method found for it, on the receiver or on its prototype. Receiver, prototype and method die. New receivers, whose structures get the old ids, have other methods.
// Env: BUN_JSC_scribbleFreeCells=1
// Env: BUN_JSC_sweepSynchronously=1
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler

class Expected {
  act(argument) {
    return "expected " + argument;
  }
}

function act(receiver) {
  return receiver.act(1);
}
function actTwice(receiver) {
  return receiver.act(2) + "/" + receiver.act(3);
}

function teach(round) {
  const own = {};
  own["only in round " + round] = 0;
  own.act = argument => "own of round " + round + " " + argument;
  const prototype = {};
  prototype["prototype of round " + round] = 0;
  prototype.act = function (argument) {
    return "inherited in round " + round + " " + argument + " " + this.id;
  };
  const heir = Object.create(prototype);
  heir.id = "heir";
  const ShortLived = class {
    act(argument) {
      return "class of round " + round + " " + argument;
    }
  };
  return [act(unknown(own)), act(unknown(own)), act(unknown(heir)), actTwice(unknown(heir)), act(unknown(new ShortLived())), actTwice(unknown(new ShortLived()))].join(" | ");
}
function fillStack(depth) {
  const some = [depth, depth + 1, depth + 2, depth + 3];
  return depth ? fillStack(depth - 1) + some.length : 0;
}

let wrong = 0;
function check(actual, expected) {
  if (actual !== expected) {
    wrong++;
    if (wrong < 10) console.log("WRONG:", actual, "instead of", expected);
  }
}

function successor(round, index) {
  const name = "successor " + round + " " + index;
  switch (index % 4) {
    case 0: {
      const value = {};
      value[name] = 0;
      value.act = argument => name + " own " + argument;
      return [value, name + " own "];
    }
    case 1: {
      const prototype = {};
      prototype[name] = 0;
      prototype.pad = 0;
      prototype.act = argument => name + " inherited " + argument;
      const value = Object.create(prototype);
      value.id = index;
      return [value, name + " inherited "];
    }
    case 2: {
      const value = new (class {
        act(argument) {
          return name + " class " + argument;
        }
      })();
      return [value, name + " class "];
    }
    default: {
      const value = Object.create(Expected.prototype);
      value[name] = 0;
      return [value, "expected "];
    }
  }
}

for (let round = 0; round < 8; round++) {
  console.log(act(new Expected()), "|", teach(round));
  fillStack(50);
  Bun.gc(true);
  const kept = [];
  for (let index = 0; index < 600; index++) {
    const [value, prefix] = successor(round, index);
    kept.push(value);
    check(act(unknown(value)), prefix + 1);
    check(actTwice(unknown(value)), prefix + 2 + "/" + prefix + 3);
  }
  console.log("round", round, "kept", kept.length, "wrong", wrong, act(new Expected()));
}

export {};
