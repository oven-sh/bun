// A pattern without elements opens an iterator, which reads `next`, and closes it, which calls `return`. Each object here is its own iterator, and nothing but its pattern ever asks it for `next`.
const said = [];
const step = () => ({ done: true });

const [] = {
  [Symbol.iterator]() {
    return this;
  },
  get next() {
    said.push("declared");
    return step;
  },
  return() {
    said.push("closed");
    return {};
  },
};

function take(from) {
  const [] = from;
}
take({
  [Symbol.iterator]() {
    return this;
  },
  get next() {
    said.push("declared in a function");
    return step;
  },
  return() {
    said.push("closed");
    return {};
  },
});

[] = {
  [Symbol.iterator]() {
    return this;
  },
  get next() {
    said.push("assigned");
    return step;
  },
  return() {
    said.push("closed");
    return {};
  },
};

(([]) => {})({
  [Symbol.iterator]() {
    return this;
  },
  get next() {
    said.push("a parameter");
    return step;
  },
  return() {
    said.push("closed");
    return {};
  },
});

class Steps {
  [Symbol.iterator]() {
    return this;
  }
  get next() {
    said.push("of a class");
    return step;
  }
  return() {
    said.push("closed");
    return {};
  }
}
const [] = new Steps();

console.log(said.join("\n"));
