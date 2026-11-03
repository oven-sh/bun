// `super.step()` up a row of classes where the method at the top only returns a constant: nothing of the call is left,
// and nothing of the read of the method either. Beside it the rows where the read shows: a getter above, a proxy above,
// a method that is replaced, redefined as a getter or deleted later, another object put above the prototype.
const log = [];

class Plain {
  step() {
    return 1;
  }
}
class PlainBelow extends Plain {
  step() {
    return super.step() + 1;
  }
}
class PlainLowest extends PlainBelow {
  step() {
    return super.step() + 1;
  }
}

class WithGetter {
  get step() {
    log.push("getter");
    return () => 1;
  }
}
class BelowGetter extends WithGetter {
  get step() {
    return () => {
      super.step();
      return 2;
    };
  }
}

class Changed {
  step() {
    return 1;
  }
}
class BelowChanged extends Changed {
  step() {
    super.step();
    return 2;
  }
}

class AboveProxy {
  step() {
    return 1;
  }
}
class BelowProxy extends AboveProxy {
  step() {
    super.step();
    return 2;
  }
}

class OnlyRead {
  step() {
    return 1;
  }
}
class BelowOnlyRead extends OnlyRead {
  step() {
    super.step;
    return typeof super.step;
  }
  same() {
    return super.step === OnlyRead.prototype.step;
  }
}

function run(object, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += object.step() + (i & 1);
  return sum;
}

console.log("plain", run(new PlainLowest(), 1000));
console.log("getter", run(new BelowGetter(), 3), log.join());
log.length = 0;

const changed = new BelowChanged();
console.log("changed", run(changed, 1000));
Changed.prototype.step = function () {
  log.push("replaced");
  return 5;
};
console.log("replaced", run(changed, 2), log.join());
log.length = 0;
Object.defineProperty(Changed.prototype, "step", {
  configurable: true,
  get() {
    log.push("defined getter");
    return () => 0;
  },
});
console.log("a getter defined", run(changed, 2), log.join());
log.length = 0;
delete Changed.prototype.step;
try {
  run(changed, 1);
} catch (error) {
  console.log("deleted", error instanceof TypeError);
}

const belowProxy = new BelowProxy();
console.log("before the proxy", run(belowProxy, 1000));
Object.setPrototypeOf(
  BelowProxy.prototype,
  new Proxy(AboveProxy.prototype, {
    get(target, key, receiver) {
      log.push(`get ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
  }),
);
console.log("a proxy above", run(belowProxy, 2), log.join());
log.length = 0;
Object.setPrototypeOf(BelowProxy.prototype, {
  get step() {
    log.push("other object");
    return () => 0;
  },
});
console.log("another object above", run(belowProxy, 2), log.join());

const onlyRead = new BelowOnlyRead();
console.log("only read", onlyRead.step(), onlyRead.same());
