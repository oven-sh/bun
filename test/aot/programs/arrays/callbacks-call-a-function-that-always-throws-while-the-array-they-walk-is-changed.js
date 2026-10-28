// Callbacks of array methods that call a function which always throws, while the array they walk over is shrunk, grown or given holes.
function fail(message = "fail") {
  throw new Error(message);
}
function show(name, run) {
  try {
    console.log(name, JSON.stringify(run()));
  } catch (error) {
    console.log(name, "threw", error.message);
  }
}
globalThis.hidden = [chunk => fail(chunk)];
try {
  globalThis.hidden[0]({ toString: () => "object" });
} catch (error) {
  console.log(error.message);
}
const changing = (list, change) => ({
  toString() {
    change(list);
    return "changed";
  },
});
const changes = {
  shrinks: list => {
    list.length = 1;
  },
  grows: list => {
    list.push(7, 8);
  },
  makesHoles: list => {
    delete list[2];
    delete list[3];
  },
  takesFractions: list => {
    list[3] = 1.5;
  },
  takesTexts: list => {
    list[3] = "text";
  },
  becomesSparse: list => {
    list[100000] = 9;
    list.length = 5;
  },
};
function throwsOut(items) {
  return items.map(item => {
    if (item === 3) {
      fail("three");
    }
    return item;
  });
}
function catchesInside(items, change) {
  return items.map(item => {
    if (item === 2) {
      try {
        fail(changing(items, change));
      } catch (error) {
        return error.message;
      }
    }
    return item;
  });
}
function catchesInsideFilterAndMap(items, change) {
  return items
    .filter(item => {
      if (item === 2) {
        try {
          fail(changing(items, change));
        } catch {}
      }
      return item > 0;
    })
    .map(item => {
      if (item === 99) {
        fail("ninety-nine");
      }
      return item;
    });
}
function catchesInsideForEach(items, change) {
  const seen = [];
  items.forEach((item, index) => {
    if (item === 2) {
      try {
        fail(changing(items, change));
      } catch {}
    }
    seen.push(index + ":" + item);
  });
  return seen;
}
function catchesOutside(items, change) {
  const seen = [];
  try {
    items.map(item => {
      seen.push(item);
      if (item === 2) {
        fail(changing(items, change));
      }
      return item;
    });
  } catch (error) {
    seen.push(error.message);
  }
  for (let index = 0; index < items.length; index++) {
    seen.push(index in items ? items[index] : "hole");
  }
  return seen;
}
function changesWithoutThrowing(items, change) {
  return items.map(item => {
    if (item === 2) {
      change(items);
    }
    if (item === 99) {
      fail("ninety-nine");
    }
    return item;
  });
}
show("throws out", () => throwsOut([1, 2, 3, 4, 5]));
show("throws nothing", () => throwsOut([1, 2, 4, 5]));
for (const [name, change] of Object.entries(changes)) {
  show("catches inside, " + name, () => catchesInside([1, 2, 3, 4, 5], change));
  show("catches inside filter and map, " + name, () => catchesInsideFilterAndMap([1, 2, 3, 4, 5], change));
  show("catches inside forEach, " + name, () => catchesInsideForEach([1, 2, 3, 4, 5], change));
  show("catches outside, " + name, () => catchesOutside([1, 2, 3, 4, 5], change));
  show("changes without throwing, " + name, () => changesWithoutThrowing([1, 2, 3, 4, 5], change));
}
