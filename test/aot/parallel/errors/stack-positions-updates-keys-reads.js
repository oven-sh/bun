// Each function updates a property under a key: `q[k]++`, `q[k] += 1`, `q[k] ||= 1`. Prints where the function stands in the stack of an error that a getter, a
// setter, a trap of a proxy or a conversion under the update throws, and of the error for an object that is null or undefined.
const k = String("nope");
const five = Number("5");
function id(value) {
  return value;
}
function fail() {
  throw new Error("failed");
}
function show(f) {
  try {
    f();
    console.log(f.name, "did not throw");
  } catch (error) {
    const lines = String(error.stack).split("\n").slice(1);
    const at = lines.findIndex(line => line.includes(f.name));
    console.log(f.name, error.name, at, /:(\d+:\d+)\)?$/.exec(lines[at] ?? "")?.[1]);
  }
}
show(function form1() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q[k]++;
});
show(function form2() {
  const q = {
    get nope() {
      return fail();
    },
  };
  ++q[k];
});
show(function form3() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q[k] += 1;
});
show(function form4() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q[k] ||= 1;
});
show(function form5() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q[k] ??= 1;
});
show(function form6() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q.nope++;
});
show(function form7() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q.nope += 1;
});
show(function form8() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q["nope"]++;
});
show(function form9() {
  const q = {
    get nope() {
      return 1;
    },
    set nope(v) {
      fail();
    },
  };
  q[k]++;
});
show(function form10() {
  const q = {
    get nope() {
      return 1;
    },
    set nope(v) {
      fail();
    },
  };
  q[k] += 1;
});
show(function form11() {
  const q = {
    get nope() {
      return 1;
    },
    set nope(v) {
      fail();
    },
  };
  q.nope++;
});
show(function form12() {
  const q = {
    get nope() {
      return 1;
    },
    set nope(v) {
      fail();
    },
  };
  q[k] = 1;
});
show(function form13() {
  const q = new Proxy({}, { get: fail });
  q[k]++;
});
show(function form14() {
  const q = new Proxy({}, { get: fail });
  q[k] += 1;
});
show(function form15() {
  const q = new Proxy({}, { get: fail });
  q.x++;
});
show(function form16() {
  const q = new Proxy({}, { set: fail });
  q[k]++;
});
show(function form17() {
  const q = new Proxy({}, { set: fail });
  q[k] = 1;
});
show(function form18() {
  const q = {
    inner: {
      get nope() {
        return fail();
      },
    },
  };
  q.inner[k]++;
});
show(function form19() {
  const q = {
    inner: {
      get nope() {
        return fail();
      },
    },
  };
  id(q).inner[k]++;
});
show(function form20() {
  const q = {
    inner: {
      get nope() {
        return fail();
      },
    },
  };
  q.inner[id(k)]++;
});
show(function form21() {
  const q = {
    inner: {
      get nope() {
        return fail();
      },
    },
  };
  q["inner"][k]--;
});
show(function form22() {
  const q = {
    get nope() {
      return fail();
    },
  };
  id(q[k]++);
});
show(function form23() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q[k + ""]++;
});
show(function form24() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q[`${k}`]++;
});
show(function form25() {
  const q = {
    get nope() {
      return { valueOf: fail };
    },
  };
  q[k]++;
});
show(function form26() {
  const q = {
    get 1() {
      return fail();
    },
  };
  q[five - 4]++;
});
show(function form27() {
  const q = [1];
  Object.defineProperty(q, 0, { get: fail });
  q[five - 5]++;
});
show(function form28() {
  const q = null;
  q[k]++;
});
show(function form29() {
  const q = undefined;
  q[k] += 1;
});
show(function form30() {
  const q = null;
  q[id(k)]++;
});
show(function form31() {
  const q = null;
  q[k] ||= 1;
});
show(function form32() {
  const q = { inner: null };
  q.inner[k]++;
});
show(function form33() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q[k] &&= 1;
});
show(function form34() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q[k] **= 2;
});
show(function form35() {
  const q = {
    get nope() {
      return fail();
    },
  };
  q[k]--;
});
show(function form36() {
  const q = {
    get nope() {
      return fail();
    },
  };
  [q[k]] = [q[k] + 1];
});

show(function keyIsParameter(key = k) {
  const q = {
    get nope() {
      return fail();
    },
  };
  q[key]++;
});
show(function keyIsLocal() {
  const q = {
    get nope() {
      return fail();
    },
  };
  let key = id(k);
  q[key] += 1;
});
show(function keyIsLocalAndObjectIsNull() {
  const q = null;
  let key = id(k);
  q[key] += 1;
});
show(function objectOnAnotherLine() {
  const q = {
    inner: {
      get nope() {
        return fail();
      },
    },
  };
  q.inner[k]++;
});
show(function objectIsThis() {
  const q = {
    get nope() {
      return fail();
    },
    update() {
      this[k]++;
    },
  };
  q.update();
});
show(function objectIsCall() {
  const q = {
    get nope() {
      return fail();
    },
  };
  id(q)[k]++;
});
show(function getterIsKnown() {
  class Holder {
    get nope() {
      return fail();
    }
  }
  const q = new Holder();
  q[k]++;
});
show(function inLoop() {
  const q = {
    count: 0,
    get nope() {
      return fail();
    },
  };
  for (const key of ["count", "count", k]) q[key]++;
});
