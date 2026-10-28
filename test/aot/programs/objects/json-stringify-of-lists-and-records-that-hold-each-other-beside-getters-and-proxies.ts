// Lists and records that hold themselves or each other stand beside a toJSON, a getter and a proxy. Each call of JSON.stringify prints the error and what ran before it, in order.
let log: string[] = [];

const list: unknown[] = [
  {
    toJSON() {
      log.push("first");
      return 1;
    },
  },
];
list.push(list);

const withList: { items: unknown[]; tail: unknown } = {
  items: [
    {
      toJSON() {
        log.push("item");
        return 2;
      },
    },
  ],
  tail: 0,
};
withList.items.push(withList);

const listOfLists: unknown[][] = [
  [
    {
      toJSON() {
        log.push("inner");
        return 3;
      },
    },
  ],
];
listOfLists[0].push(listOfLists);

const withGetter: { before: unknown; self: unknown } = {
  before: {
    get x() {
      log.push("getter");
      return 4;
    },
  },
  self: null,
};
withGetter.self = withGetter;

const withProxy: { before: unknown; self: unknown } = {
  before: new Proxy(
    { a: 1 },
    {
      ownKeys(target) {
        log.push("ownKeys");
        return Reflect.ownKeys(target);
      },
      get(target, key, receiver) {
        log.push("get " + String(key));
        return Reflect.get(target, key, receiver);
      },
    },
  ),
  self: null,
};
withProxy.self = withProxy;

const throughToJSON: { before: unknown; way: unknown } = {
  before: {
    toJSON() {
      log.push("before");
      return 5;
    },
  },
  way: null,
};
throughToJSON.way = {
  toJSON() {
    log.push("way");
    return throughToJSON;
  },
};

interface Branch {
  label: unknown;
  branches: Branch[];
}
const tree: Branch = {
  label: {
    toJSON() {
      log.push("root");
      return 6;
    },
  },
  branches: [],
};
const leaf: Branch = {
  label: {
    toJSON() {
      log.push("leaf");
      return 7;
    },
  },
  branches: [],
};
tree.branches.push(leaf, leaf);
const closedTree: Branch = {
  label: {
    toJSON() {
      log.push("closed root");
      return 8;
    },
  },
  branches: [leaf],
};
closedTree.branches.push(closedTree);

const shared = {
  toJSON() {
    log.push("shared");
    return 9;
  },
};
const twice: { left: unknown; right: unknown; both: unknown[] } = { left: { shared }, right: null, both: [] };
twice.right = twice.left;
twice.both.push(twice.left, twice.left);

for (const value of [list, withList, listOfLists, withGetter, withProxy, throughToJSON, tree, closedTree, twice]) {
  log = [];
  try {
    console.log(JSON.stringify(value), log.join());
  } catch (error) {
    console.log(String(error), log.join());
  }
}
