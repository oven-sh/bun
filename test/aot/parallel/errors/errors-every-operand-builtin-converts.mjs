// A built-in function converts several of its operands, one after the other. Each operand in turn is one whose conversion throws, inside a
// try of the caller, with the result used and unused, in a function and in the top-level code. What is printed: which conversions ran, the
// error that the catch got, and the frames of its stack.
const seen = [];
const framesOf = error =>
  String(error.stack)
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/[^ (]*[\\/]/, ""))
    .join(" < ");
const describe = error => `${seen.splice(0).join(",")} | ${error.name}: ${error.message} | ${framesOf(error)}`;
const good = name => ({
  toString() {
    seen.push(name);
    return "1";
  },
});
const bad = name => ({
  toString() {
    seen.push(name);
    throw new RangeError(name + " throws");
  },
});
function revoked() {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}
const throwing = [() => bad("thrower"), () => Symbol("symbol"), () => 1n, revoked];

function unused(call, a, b, c) {
  try {
    call(a, b, c);
    return seen.splice(0).join(",") + " | returned";
  } catch (error) {
    return describe(error);
  }
}

const calls = {
  fontsize(a, b) {
    try {
      String.prototype.fontsize.call(a, b);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  fontsizeUsed(a, b) {
    try {
      return seen.splice(0).join(",") + String.prototype.fontsize.call(a, b);
    } catch (error) {
      return describe(error);
    }
  },
  indexOf(a, b, c) {
    try {
      String.prototype.indexOf.call(a, b, c);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  indexOfUsed(a, b, c) {
    try {
      return String.prototype.indexOf.call(a, b, c) + " " + seen.splice(0).join(",");
    } catch (error) {
      return describe(error);
    }
  },
  slice(a, b, c) {
    try {
      "abcdef".slice(b, c);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  substring(a, b, c) {
    try {
      a.toString().substring(b, c);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  padStart(a, b, c) {
    try {
      String.prototype.padStart.call(a, b, c);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  pow(a, b) {
    try {
      Math.pow(a, b);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  max(a, b, c) {
    try {
      Math.max(a, b, c);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  maxUsed(a, b, c) {
    try {
      return Math.max(a, b, c) + " " + seen.splice(0).join(",");
    } catch (error) {
      return describe(error);
    }
  },
  atan2(a, b) {
    try {
      Math.atan2(a, b);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  utc(a, b, c) {
    try {
      Date.UTC(a, b, c);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  fromCharCode(a, b, c) {
    try {
      String.fromCharCode(a, b, c);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  parseInt(a, b) {
    try {
      parseInt(a, b);
      return seen.splice(0).join(",") + " | returned";
    } catch (error) {
      return describe(error);
    }
  },
  finallyRuns(a, b) {
    let ran = "";
    try {
      try {
        String.prototype.anchor.call(a, b);
      } finally {
        ran = "finally ran, ";
      }
      return ran + "returned";
    } catch (error) {
      return ran + describe(error);
    }
  },
};

for (const [name, call] of Object.entries(calls)) {
  for (let position = 0; position < call.length; position++) {
    for (const make of throwing) {
      const operands = [good("first"), good("second"), good("third")];
      operands[position] = make();
      console.log(name, position, call(...operands));
    }
  }
}

console.log(unused((a, b) => String.prototype.link.call(a, b), good("first"), revoked()));
console.log(unused((a, b) => void String.prototype.link.call(a, b), good("first"), bad("second")));

try {
  const unread = String.prototype.fontsize(revoked());
  console.log("returned");
} catch (error) {
  console.log("the top-level code", describe(error));
}
try {
  String.prototype.fontcolor.call(good("first"), Symbol("second"));
  console.log("returned");
} catch (error) {
  console.log("the top-level code", describe(error));
}
