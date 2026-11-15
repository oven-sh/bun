globalThis.readersElsewhere = {
  weigh(thing) {
    return thing.weight;
  },
  measure(shelf) {
    return shelf.depth;
  },
  truth(shelf) {
    return shelf.depth ? "yes" : "no";
  },
  look(gauge) {
    return gauge.level;
  },
  bump(target, by) {
    target.count = by;
    target.spare = by + 1;
  },
};
