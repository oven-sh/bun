// `o[k]++`, `o[k] += v`, `o[k] ??= v` and their like with `o` undefined or null: what the error says, for keys of every kind and however the key is written, and what has run by then.
const symbol = Symbol("key");
const said = [];
const objectKey = {
  toString() {
    said.push("converted");
    return "k";
  },
};
function show(label, run) {
  for (const holder of [undefined, null]) {
    said.length = 0;
    try {
      run(holder);
      console.log(label, String(holder), "no error");
    } catch (error) {
      console.log(label, String(holder), error.name + ": " + error.message.split(" (evaluating")[0], said.join());
    }
  }
}

function keyed(label, key) {
  show(label + " post++", holder => {
    holder[key]++;
  });
  show(label + " post--", holder => {
    holder[key]--;
  });
  show(label + " pre++", holder => {
    ++holder[key];
  });
  show(label + " pre--", holder => {
    --holder[key];
  });
  show(label + " used post++", holder => holder[key]++);
  show(label + " used pre++", holder => ++holder[key]);
  show(label + " +=", holder => {
    holder[key] += 1;
  });
  show(label + " -=", holder => {
    holder[key] -= 1;
  });
  show(label + " **=", holder => {
    holder[key] **= 2;
  });
  show(label + " >>>=", holder => {
    holder[key] >>>= 1;
  });
  show(label + " &&=", holder => {
    holder[key] &&= 1;
  });
  show(label + " ||=", holder => {
    holder[key] ||= 1;
  });
  show(label + " ??=", holder => {
    holder[key] ??= 1;
  });
  show(label + " read", holder => holder[key]);
  show(label + " delete", holder => delete holder[key]);
  show(label + " call", holder => holder[key]());
}
for (const [label, key] of [
  ["symbol", symbol],
  ["text", "name"],
  ["index", 3],
  ["fraction", 1.5],
  ["object", objectKey],
  ["undefined", undefined],
  ["null", null],
  ["true", true],
  ["bigint", 7n],
])
  keyed(label, key);

// A key that is written as a number or a text, or that is one by the time the file runs, has no test ahead of the read.
show("written text", holder => {
  holder["name"]++;
});
show("written index", holder => {
  holder[0]++;
});
show("written negative", holder => {
  holder[-1]++;
});
show("written fraction", holder => {
  holder[1.5]++;
});
show("written large index", holder => {
  holder[4294967296]++;
});
show("written template", holder => {
  holder[`name`]++;
});
show("written template with a text", holder => {
  holder[`na${"me"}`]++;
});
show("written template with a number", holder => {
  holder[`n${1}`] += 1;
});
show("written template with null", holder => {
  holder[`n${null}`] ||= 1;
});
show("written template in a template", holder => {
  holder[`n${`a${"b"}`}`]++;
});
show("written template and a text", holder => {
  holder[`a${"b"}` + "c"]++;
});
show("written sum", holder => {
  holder["na" + "me"]++;
});
show("written sum of numbers", holder => {
  holder[1 + 2]++;
});
show("written typeof", holder => {
  holder[typeof 1]++;
});
show("written choice", holder => {
  holder[true ? "a" : "b"]++;
});
show("written comma", holder => {
  holder[(0, "a")]++;
});
show("written length", holder => {
  holder["ab".length]++;
});
show("written Infinity", holder => {
  holder[Infinity]++;
});
show("written -Infinity", holder => {
  holder[-Infinity]++;
});
show("constant text", holder => {
  const k = "name";
  holder[k]++;
});
show("constant number", holder => {
  const k = 4;
  holder[k] += 2;
});
show("constant template", holder => {
  const k = `na${"me"}`;
  holder[k] ??= 1;
});
show("written dot", holder => {
  holder.name++;
});
show("written dot +=", holder => {
  holder.name += 1;
});
show("written dot ??=", holder => {
  holder.name ??= 1;
});

// Any other key has.
show("written true", holder => {
  holder[true]++;
});
show("written false", holder => {
  holder[false] += 1;
});
show("written null", holder => {
  holder[null] ??= 1;
});
show("written not", holder => {
  holder[!0]++;
});
show("written undefined", holder => {
  holder[undefined]++;
});
show("written void", holder => {
  holder[void 0]++;
});
show("written NaN", holder => {
  holder[NaN]++;
});
show("written quotient that is no number", holder => {
  holder[0 / 0]++;
});
show("written bigint", holder => {
  holder[7n]++;
});
show("written object", holder => {
  holder[
    {
      toString() {
        said.push("converted");
        return "k";
      },
    }
  ]++;
});
show("written list", holder => {
  holder[[1]]++;
});
show("written function", holder => {
  holder[function () {}]++;
});
show("written new", holder => {
  holder[new String("k")]++;
});
show("written well-known symbol", holder => {
  holder[Symbol.iterator]++;
});
show("written call", holder => {
  holder[(said.push("called"), String("k"))]++;
});
show("constant true", holder => {
  const k = true;
  holder[k]++;
});
show("constant null", holder => {
  const k = null;
  holder[k]++;
});
show("constant behind a statement", holder => {
  said.push("first");
  const k = "name";
  holder[k] ??= 1;
});
show("variable", holder => {
  let k = "name";
  k += "";
  holder[k]++;
});
show("variable of the file", holder => {
  holder[symbol] ||= 2;
});

// The right side does not run.
show("right side", holder => {
  holder[symbol] += said.push("right");
});
show("right side of ??=", holder => {
  holder[symbol] ??= said.push("right");
});

// Holders that the compiler knows more or less about.
show("known undefined", () => {
  const nothing = undefined;
  nothing[symbol]++;
});
show("known null", () => {
  const nothing = null;
  nothing[symbol] += 1;
});
show("field", holder => {
  const box = { inner: holder };
  box.inner[symbol]++;
});
show("field or object", holder => {
  const box = { inner: said.length ? {} : holder };
  box.inner[symbol]++;
});
show("text or nothing", holder => {
  const value = said.length ? "text" : holder;
  value[symbol]++;
});
class Counter {
  static count(key) {
    this[key]++;
  }
  cork() {
    this[symbol]++;
  }
}
show("this", holder => {
  Counter.count.call(holder, symbol);
});
show("this of a method", holder => {
  Counter.prototype.cork.call(holder);
});
show("super", holder => {
  const o = {
    __proto__: holder,
    m(k) {
      super[k]++;
    },
  };
  o.m(symbol);
});
show("super under a name", holder => {
  const o = {
    __proto__: holder,
    m() {
      super.name++;
    },
  };
  o.m();
});
show("in a loop", holder => {
  for (let i = 0; i < 3; i++) holder[i]++;
});
show("in a finally", holder => {
  try {
    said.push("try");
  } finally {
    holder[symbol]--;
  }
});
show("behind an optional chain", holder => {
  (holder?.inner)[symbol]++;
});
show("in a default", holder => {
  const [a = holder[symbol]++] = [];
});
show("two deep", holder => {
  const o = { a: holder };
  o["a"][symbol][symbol]++;
});
show("behind a read that passes", holder => {
  const o = { a: { b: holder } };
  o.a[symbol + ""]?.c;
  o.a.b[symbol]++;
});

async function later(holder) {
  await 0;
  holder[symbol]++;
}
function* steps(holder) {
  yield 1;
  holder[symbol] += 1;
}
for (const holder of [undefined, null]) {
  try {
    const iterator = steps(holder);
    iterator.next();
    iterator.next();
  } catch (error) {
    console.log("generator", error.message);
  }
  await later(holder).catch(error => console.log("async", error.message));
}

// The same function meets objects first.
function count(holder, key) {
  holder[key]++;
  return holder;
}
for (let i = 0; i < 100; i++) count({ a: i }, "a");
for (const holder of [{ a: 1 }, undefined, [1], null, "text"]) {
  try {
    console.log("warm", JSON.stringify(count(holder, holder instanceof Array ? 0 : "a")));
  } catch (error) {
    console.log("warm", error.message.split(" (evaluating")[0]);
  }
}
