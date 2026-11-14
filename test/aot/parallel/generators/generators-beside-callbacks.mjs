// A generator that a loop takes in place stands among copies of methods that call each other back.
class Owner {
  constructor(limit) {
    this.limit = limit;
    this.seen = [];
    this.root = "root";
  }
  create(parent, name) {
    if (this.seen.length >= this.limit) return undefined;
    this.check(parent + name);
    return name.length > 2 ? parent + "/" + name : undefined;
  }
  check(name) {
    this.seen.push(name);
  }
  neutral(parent, n, forbidden) {
    for (const name of names(n, forbidden)) {
      const created = this.create(parent, name);
      if (created) return created;
    }
    return;
  }
}
function* names(n, forbidden) {
  let count = 0;
  for (let attempt = 0; attempt < 96 && count < 24; attempt++) {
    const name = "x".repeat(n + (attempt % 3));
    if (!forbidden(name)) {
      count++;
      yield name;
    }
  }
}
function observe(getOwner, left) {
  let parent;
  for (let i = 0; i < left.length; i++) {
    const owner = getOwner();
    parent ??= owner.root;
    const forbidden = name => name === left[i];
    let next;
    if (i < left.length - 1) {
      next ??= owner.neutral(parent, i % 3, forbidden);
      if (!next) return i;
      parent = next;
    }
  }
  return true;
}
function probe(options) {
  let owner, observed;
  try {
    observed = observe(() => (owner ??= new Owner(options.limit)), options.left.split("/"));
  } finally {
    if (owner) observed = observed + ":" + owner.seen.join();
  }
  return observed;
}
for (const left of ["a/b", "a/b/c", "xx/xxx/x/y", "q", "a/b/c/d/e/f/g/h"]) for (const limit of [0, 2, 50]) console.log(probe({ left, limit }));
