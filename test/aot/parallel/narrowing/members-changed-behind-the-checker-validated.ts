// TypeScript keeps the narrowed type of `a.b` until `a.b` itself is assigned, so an alias, a call, a getter or an `await` can change the property between the check and the use. Every use must see the current value, as in plain Bun, and code that ran before the use must not run again.
// Flags: --aot-validate
// Erased types: not built: members-changed-behind-the-checker is built so
class Leaf {
  kind = "leaf" as const;
  text: string;
  weight = 1;
  constructor(text: string) {
    this.text = text;
  }
  describe(): string {
    return "leaf " + this.text;
  }
  shout(): string {
    return this.text.toUpperCase();
  }
}

class Branch {
  kind = "branch" as const;
  weight = "heavy";
  children: Tree[];
  constructor(children: Tree[]) {
    this.children = children;
  }
  describe(): string {
    return "branch of " + this.children.length;
  }
}

type Tree = Leaf | Branch;

interface Slot {
  item: Tree;
}

class Holder {
  item: Tree;
  constructor(item: Tree) {
    this.item = item;
  }
  setItem(item: Tree): void {
    this.item = item;
  }
  readAfterAliasStore(alias: Holder, other: Tree): string {
    if (this.item instanceof Leaf) {
      alias.item = other;
      return format(this.item.text, this.item.describe());
    }
    return "not a leaf";
  }
  readAfterOwnMethod(other: Tree): string {
    if (this.item instanceof Leaf) {
      this.setItem(other);
      return format(this.item.text, this.item.describe());
    }
    return "not a leaf";
  }
}

class Outer {
  inner: Holder;
  constructor(inner: Holder) {
    this.inner = inner;
  }
}

function format(...values: unknown[]): string {
  return values.map(value => String(value)).join(" ");
}

function isLeaf(tree: Tree): tree is Leaf {
  return tree instanceof Leaf;
}

function assertLeaf(tree: Tree): asserts tree is Leaf {
  if (!(tree instanceof Leaf)) throw new RangeError("not a leaf");
}

function setItem(holder: Holder, item: Tree): void {
  holder.item = item;
}

function setItemAndReturnTrue(holder: Holder, item: Tree): boolean {
  holder.item = item;
  return true;
}

function setItemThenCheckLeaf(tree: Tree, holder: Holder, item: Tree): tree is Leaf {
  holder.item = item;
  return tree instanceof Leaf;
}

function itemKey(): "item" {
  return "item";
}

function checkInstanceof(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    alias.item = other;
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function checkTypePredicate(holder: Holder, alias: Holder, other: Tree): string {
  if (isLeaf(holder.item)) {
    alias.item = other;
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function checkDiscriminant(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item.kind === "leaf") {
    alias.item = other;
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function checkInOperator(holder: Holder, alias: Holder, other: Tree): string {
  if ("text" in holder.item) {
    alias.item = other;
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function checkAssertion(holder: Holder, alias: Holder, other: Tree): string {
  assertLeaf(holder.item);
  alias.item = other;
  return format(holder.item.text, holder.item.describe());
}

function checkSwitch(holder: Holder, alias: Holder, other: Tree): string {
  switch (holder.item.kind) {
    case "leaf":
      alias.item = other;
      return format(holder.item.text, holder.item.describe());
    case "branch":
      alias.item = other;
      return format(holder.item.children.length, holder.item.describe());
    default:
      return "neither";
  }
}

function checkSwitchTrue(holder: Holder, alias: Holder, other: Tree): string {
  switch (true) {
    case holder.item instanceof Leaf:
      alias.item = other;
      return format(holder.item.text, holder.item.describe());
    default:
      return "not a leaf";
  }
}

function checkAliasedCondition(view: { readonly item: Tree }, alias: Holder, other: Tree): string {
  const wasLeaf = view.item instanceof Leaf;
  alias.item = other;
  if (wasLeaf) return format(view.item.text, view.item.describe());
  return "not a leaf";
}

function checkEarlyReturn(holder: Holder, alias: Holder, other: Tree): string {
  if (!(holder.item instanceof Leaf)) return "not a leaf";
  alias.item = other;
  return format(holder.item.text, holder.item.describe());
}

function checkAndUseInOneExpression(holder: Holder, alias: Holder, other: Tree): string {
  return holder.item instanceof Leaf && setItemAndReturnTrue(alias, other) ? format(holder.item.text, holder.item.describe()) : "not a leaf";
}

function changeInCall(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    setItem(alias, other);
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeInClosure(holder: Holder, alias: Holder, other: Tree): string {
  const change = () => {
    alias.item = other;
  };
  if (holder.item instanceof Leaf) {
    change();
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeInAliasMethod(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    alias.setItem(other);
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeInHolderMethod(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    holder.setItem(other);
    return format(holder.item.text, holder.item.describe(), alias.item.describe());
  }
  return "not a leaf";
}

function changeInToString(holder: Holder, alias: Holder, other: Tree): string {
  const trigger = {
    toString(): string {
      alias.item = other;
      return "converted";
    },
  };
  if (holder.item instanceof Leaf) {
    return format(`${trigger}`, holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeInBuiltinCallback(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    [other].forEach(item => {
      alias.item = item;
    });
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeBetweenArguments(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    return format(holder.item.text, setItemAndReturnTrue(alias, other), holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeInTypePredicate(holder: Holder, alias: Holder, other: Tree): string {
  if (setItemThenCheckLeaf(holder.item, alias, other)) {
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeWithObjectAssign(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    Object.assign(alias, { item: other });
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeWithReflectSet(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    Reflect.set(alias, "item", other);
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeWithComputedKey(holder: Holder, alias: Holder, other: Tree): string {
  const key = itemKey();
  if (holder.item instanceof Leaf) {
    alias[key] = other;
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeWithDestructuring(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    ({ item: alias.item } = { item: other });
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function* readAcrossYield(holder: Holder): Generator<string, string, void> {
  if (holder.item instanceof Leaf) {
    yield holder.item.text;
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function changeBetweenYields(holder: Holder, alias: Holder, other: Tree): string {
  const generator = readAcrossYield(holder);
  const first = generator.next();
  alias.item = other;
  const second = generator.next();
  return format(first.value, first.done, second.value, second.done);
}

async function changeDuringAwait(holder: Holder, alias: Holder, other: Tree): Promise<string> {
  if (holder.item instanceof Leaf) {
    queueMicrotask(() => {
      alias.item = other;
    });
    await Promise.resolve();
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function deleteProperty(holder: Holder, alias: Holder): string {
  if (holder.item instanceof Leaf) {
    delete (alias as { item?: Tree }).item;
    return format(Object.keys(holder).join(), holder.item.text);
  }
  return "not a leaf";
}

function thisProperty(holder: Holder, alias: Holder, other: Tree): string {
  return holder.readAfterAliasStore(alias, other);
}

function thisPropertyOwnMethod(holder: Holder, alias: Holder, other: Tree): string {
  return format(holder.readAfterOwnMethod(other), alias.item.describe());
}

function interfaceProperty(slot: Slot, alias: Slot, other: Tree): string {
  if (slot.item instanceof Leaf) {
    alias.item = other;
    return format(slot.item.text, slot.item.describe());
  }
  return "not a leaf";
}

function nestedPropertyLastStep(outer: Outer, alias: Outer, other: Tree): string {
  if (outer.inner.item instanceof Leaf) {
    alias.inner.item = other;
    return format(outer.inner.item.text, outer.inner.item.describe());
  }
  return "not a leaf";
}

function nestedPropertyFirstStep(outer: Outer, alias: Outer, other: Tree): string {
  if (outer.inner.item instanceof Leaf) {
    alias.inner = new Holder(other);
    return format(outer.inner.item.text, outer.inner.item.describe());
  }
  return "not a leaf";
}

function tupleElement(pair: [Tree, number], alias: [Tree, number], other: Tree): string {
  if (pair[0] instanceof Leaf) {
    alias[0] = other;
    return format(pair[0].text, pair[0].describe());
  }
  return "not a leaf";
}

function arrayElement(list: Tree[], alias: Tree[], other: Tree): string {
  if (list[0] instanceof Leaf) {
    alias[0] = other;
    return format(list[0].text, list[0].describe());
  }
  return "not a leaf";
}

function arrayElementAfterUnshift(list: Tree[], alias: Tree[], other: Tree): string {
  if (list[0] instanceof Leaf) {
    alias.unshift(other);
    return format(list[0].text, list[0].describe());
  }
  return "not a leaf";
}

function arrayElementAfterTruncation(list: Tree[], alias: Tree[]): string {
  if (list[0] instanceof Leaf) {
    alias.length = 0;
    return format(list[0].text);
  }
  return "not a leaf";
}

const sharedHolder = new Holder(new Leaf("shared"));
let activeHolder = new Holder(new Leaf("active"));

class Registry {
  static current: Tree = new Leaf("registered");
  static setCurrent(item: Tree): void {
    Registry.current = item;
  }
}

function setActiveHolder(holder: Holder): void {
  activeHolder = holder;
}

function moduleConstProperty(first: Tree, other: Tree): string {
  sharedHolder.item = first;
  if (sharedHolder.item instanceof Leaf) {
    setItem(sharedHolder, other);
    return format(sharedHolder.item.text, sharedHolder.item.describe());
  }
  return "not a leaf";
}

function reassignedModuleVariable(first: Tree, other: Tree): string {
  activeHolder = new Holder(first);
  if (activeHolder.item instanceof Leaf) {
    setActiveHolder(new Holder(other));
    return format(activeHolder.item.text, activeHolder.item.describe());
  }
  return "not a leaf";
}

function staticProperty(first: Tree, other: Tree): string {
  Registry.current = first;
  if (Registry.current instanceof Leaf) {
    Registry.setCurrent(other);
    return format(Registry.current.text, Registry.current.describe());
  }
  return "not a leaf";
}

function localObjectProperty(first: Tree, other: Tree): string {
  const holder = new Holder(first);
  const alias = holder;
  if (holder.item instanceof Leaf) {
    alias.item = other;
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function capturedObjectProperty(first: Tree, other: Tree): string {
  const holder = new Holder(first);
  const change = () => {
    holder.item = other;
  };
  if (holder.item instanceof Leaf) {
    change();
    return format(holder.item.text, holder.item.describe());
  }
  return "not a leaf";
}

function readAllFields(holder: Holder, alias: Holder, other: Tree): string {
  if (!(holder.item instanceof Leaf)) return "not a leaf";
  const before = holder.item.text;
  alias.item = other;
  return format(before, holder.item.text, holder.item.weight, holder.item.weight + 1, holder.item.kind, typeof holder.item.shout, "text" in holder.item);
}

function callLeafOnlyMethod(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    alias.item = other;
    return holder.item.shout();
  }
  return "not a leaf";
}

function leafSummary(leaf: Leaf): string {
  return leaf.text + "/" + leaf.describe();
}

function passToTypedParameter(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    alias.item = other;
    return leafSummary(holder.item);
  }
  return "not a leaf";
}

class LeafHolder {
  leaf: Leaf;
  constructor(leaf: Leaf) {
    this.leaf = leaf;
  }
}

function storeToTypedField(holder: Holder, alias: Holder, other: Tree): string {
  const target = new LeafHolder(new Leaf("initial"));
  if (holder.item instanceof Leaf) {
    alias.item = other;
    target.leaf = holder.item;
  }
  return format(target.leaf.text, target.leaf.describe(), Object.keys(target).join());
}

function takeLeaf(holder: Holder, alias: Holder, other: Tree): Leaf | undefined {
  if (holder.item instanceof Leaf) {
    alias.item = other;
    return holder.item;
  }
  return undefined;
}

function returnFromTypedFunction(holder: Holder, alias: Holder, other: Tree): string {
  const leaf = takeLeaf(holder, alias, other);
  return leaf ? format(leaf.text, leaf.describe()) : "not a leaf";
}

function bindToConst(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    alias.item = other;
    const leaf = holder.item;
    const readText = () => leaf.text;
    return format(leaf.text, readText(), leaf.describe());
  }
  return "not a leaf";
}

function pushToTypedArray(holder: Holder, alias: Holder, other: Tree): string {
  const leaves: Leaf[] = [];
  if (holder.item instanceof Leaf) {
    alias.item = other;
    leaves.push(holder.item);
  }
  return leaves.map(leaf => leaf.text + "/" + leaf.describe()).join();
}

function writeThroughProperty(holder: Holder, alias: Holder, other: Tree): string {
  if (holder.item instanceof Leaf) {
    alias.item = other;
    holder.item.text = "stored";
    holder.item.weight += 1;
    return format(Object.keys(holder.item).join(), holder.item.text, holder.item.weight);
  }
  return "not a leaf";
}

function checkOutsideLoop(holder: Holder, alias: Holder, other: Tree): string {
  let result = "";
  if (holder.item instanceof Leaf) {
    for (let i = 0; i < 4; i++) {
      result += holder.item.text + ",";
      if (i === 1) alias.item = other;
    }
  }
  return result;
}

function checkInLoopCondition(holder: Holder, alias: Holder, other: Tree): string {
  let result = "";
  for (let i = 0; i < 3 && holder.item instanceof Leaf; i++) {
    if (i === 1) alias.item = other;
    result += holder.item.text + ",";
  }
  return result;
}

function useInsideTry(holder: Holder, alias: Holder, other: Tree): string {
  let trace = "";
  try {
    trace += "try ";
    if (holder.item instanceof Leaf) {
      alias.item = other;
      trace += holder.item.shout() + " ";
    }
  } catch (error) {
    trace += "caught " + (error as Error).constructor.name + " ";
  } finally {
    trace += "finally";
  }
  return trace;
}

let sideEffectCount = 0;

function sideEffectsRunOnce(holder: Holder, alias: Holder, other: Tree): string {
  let sum = 0;
  let label = "";
  const visited: number[] = [];
  for (let i = 0; i < 6; i++) {
    sideEffectCount++;
    sum += i * 1.5;
    label += i;
    visited.push(i);
    if (holder.item instanceof Leaf) {
      if (i === 3) alias.item = other;
      label += holder.item.text;
      sum += holder.item.weight;
    } else {
      label += "-";
    }
  }
  return format(sum, label, visited.join(""), sideEffectCount);
}

function manyHolders(count: number): string {
  const holders: Holder[] = [];
  for (let i = 0; i < count; i++) holders.push(new Holder(i % 5 === 4 ? new Branch([]) : new Leaf("l" + i)));
  let totalLength = 0;
  let missingCount = 0;
  for (let i = 0; i < count; i++) {
    const holder = holders[i];
    if (holder.item instanceof Leaf) {
      if (i % 7 === 3) setItem(holders[i], new Branch([holder.item]));
      const text = holder.item.text;
      if (text === undefined) missingCount++;
      else totalLength += text.length;
    }
  }
  return format(totalLength, missingCount);
}

class Alternating {
  readCount = 0;
  constructor(
    private first: Tree,
    private second: Tree,
  ) {}
  get item(): Tree {
    return this.readCount++ % 2 === 0 ? this.first : this.second;
  }
  readOwnAccessor(): string {
    if (this.item instanceof Leaf) return format(this.item.text, this.item.describe(), this.readCount);
    return format("not a leaf", this.readCount);
  }
}

function readAccessor(alternating: Alternating): string {
  if (alternating.item instanceof Leaf) return format(alternating.item.text, alternating.item.describe(), alternating.item.weight, alternating.readCount);
  return format("not a leaf", alternating.readCount);
}

function readSlot(slot: Slot): string {
  if (slot.item instanceof Leaf) return format(slot.item.text, slot.item.describe());
  return "not a leaf";
}

function readHolder(holder: Holder): string {
  if (holder.item instanceof Leaf) return format(holder.item.text, holder.item.describe());
  return "not a leaf";
}

function createAlternatingSlot(first: Tree, second: Tree): Slot {
  let readCount = 0;
  return {
    get item(): Tree {
      return readCount++ % 2 === 0 ? first : second;
    },
  };
}

function defineAlternatingGetter(first: Tree, second: Tree): Holder {
  const holder = new Holder(first);
  let readCount = 0;
  Object.defineProperty(holder, "item", {
    get: () => (readCount++ % 2 === 0 ? first : second),
    configurable: true,
  });
  return holder;
}

function createAlternatingProxy(first: Tree, second: Tree): Holder {
  let readCount = 0;
  return new Proxy(new Holder(first), {
    get(target, key, receiver) {
      if (key === "item") return readCount++ % 2 === 0 ? first : second;
      return Reflect.get(target, key, receiver);
    },
  });
}

class Cell {
  value: string | number;
  next: Cell | undefined;
  constructor(value: string | number, next?: Cell) {
    this.value = value;
    this.next = next;
  }
}

function numberArithmetic(cell: Cell, alias: Cell, other: string | number): string {
  if (typeof cell.value === "number") {
    alias.value = other;
    return format(cell.value + 1, cell.value * 2, -cell.value, cell.value < 10, cell.value | 0);
  }
  return "not a number";
}

function numberMethod(cell: Cell, alias: Cell, other: string | number): string {
  if (typeof cell.value === "number") {
    alias.value = other;
    return cell.value.toFixed(1);
  }
  return "not a number";
}

function stringReads(cell: Cell, alias: Cell, other: string | number): string {
  if (typeof cell.value === "string") {
    alias.value = other;
    return format(cell.value.length, cell.value + "!", cell.value[0]);
  }
  return "not a string";
}

function stringMethod(cell: Cell, alias: Cell, other: string | number): string {
  if (typeof cell.value === "string") {
    alias.value = other;
    return cell.value.toUpperCase();
  }
  return "not a string";
}

function clearAfterTruthyCheck(cell: Cell, alias: Cell): string {
  if (cell.next) {
    alias.next = undefined;
    return format(cell.next.value);
  }
  return "no next";
}

function clearAfterUndefinedCheck(cell: Cell, alias: Cell): string {
  if (cell.next !== undefined) {
    alias.next = undefined;
    return format(cell.next.value);
  }
  return "no next";
}

function clearAfterOptionalChain(cell: Cell, alias: Cell): string {
  if (cell.next?.value !== undefined) {
    alias.next = undefined;
    return format(cell.next.value);
  }
  return "no next";
}

enum Mode {
  Off,
  On,
}

class Dial {
  color: "red" | "green" = "red";
  mode: Mode = Mode.Off;
  isOn = true;
}

function stringLiteralProperty(dial: Dial, alias: Dial): string {
  if (dial.color === "red") {
    alias.color = "green";
    const color: "red" = dial.color;
    return color;
  }
  return "not red";
}

function enumProperty(dial: Dial, alias: Dial): number {
  if (dial.mode === Mode.Off) {
    alias.mode = Mode.On;
    const mode: Mode.Off = dial.mode;
    return mode + 10;
  }
  return -1;
}

function booleanProperty(dial: Dial, alias: Dial): string {
  if (dial.isOn) {
    alias.isOn = false;
    return dial.isOn ? "on" : "off";
  }
  return "was off";
}

class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}

function storeThroughWiderBox(leafBox: Box<Leaf>, other: Tree): string {
  const treeBox: Box<Tree> = leafBox;
  treeBox.value = other;
  return format(leafBox.value.text, leafBox.value.describe());
}

function storeThroughWiderArray(leaves: Leaf[], other: Tree): string {
  const trees: Tree[] = leaves;
  trees[0] = other;
  return format(leaves[0].text, leaves[0].describe());
}

const lines: string[] = [];

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "threw " + (error as Error).constructor.name;
  }
}

async function attemptAsync(run: () => Promise<unknown>): Promise<string> {
  try {
    return String(await run());
  } catch (error) {
    return "threw " + (error as Error).constructor.name;
  }
}

function runAliasCases<H>(label: string, testCase: (holder: H, alias: H, other: Tree) => unknown, create: (item: Tree) => H): void {
  const leafToBranch = create(new Leaf("a"));
  const leafToLeaf = create(new Leaf("b"));
  const branchToLeaf = create(new Branch([]));
  const results = [
    attempt(() => testCase(leafToBranch, leafToBranch, new Branch([]))),
    attempt(() => testCase(leafToLeaf, leafToLeaf, new Leaf("c"))),
    attempt(() => testCase(create(new Leaf("d")), create(new Leaf("e")), new Branch([]))),
    attempt(() => testCase(branchToLeaf, branchToLeaf, new Leaf("f"))),
  ];
  lines.push(label + ": " + results.join(" | "));
}

async function runAliasCasesAsync(label: string, testCase: (holder: Holder, alias: Holder, other: Tree) => Promise<unknown>): Promise<void> {
  const leafToBranch = new Holder(new Leaf("a"));
  const leafToLeaf = new Holder(new Leaf("b"));
  const branchToLeaf = new Holder(new Branch([]));
  const results = [
    await attemptAsync(() => testCase(leafToBranch, leafToBranch, new Branch([]))),
    await attemptAsync(() => testCase(leafToLeaf, leafToLeaf, new Leaf("c"))),
    await attemptAsync(() => testCase(new Holder(new Leaf("d")), new Holder(new Leaf("e")), new Branch([]))),
    await attemptAsync(() => testCase(branchToLeaf, branchToLeaf, new Leaf("f"))),
  ];
  lines.push(label + ": " + results.join(" | "));
}

function runValuePairs(label: string, testCase: (first: Tree, second: Tree) => unknown): void {
  const results = [
    attempt(() => testCase(new Leaf("g"), new Branch([]))),
    attempt(() => testCase(new Leaf("h"), new Leaf("i"))),
    attempt(() => testCase(new Branch([]), new Leaf("j"))),
  ];
  lines.push(label + ": " + results.join(" | "));
}

function runAliasedAndDistinct<H>(label: string, testCase: (holder: H, alias: H) => unknown, create: () => H): void {
  const aliased = create();
  lines.push(label + ": " + attempt(() => testCase(aliased, aliased)) + " | " + attempt(() => testCase(create(), create())));
}

function runCellCases(label: string, testCase: (cell: Cell, alias: Cell, other: string | number) => unknown): void {
  const numberToString = new Cell(5);
  const numberToNumber = new Cell(6);
  const stringToNumber = new Cell("five");
  const stringToString = new Cell("six");
  const results = [
    attempt(() => testCase(numberToString, numberToString, "7")),
    attempt(() => testCase(numberToNumber, numberToNumber, 8.5)),
    attempt(() => testCase(stringToNumber, stringToNumber, 9)),
    attempt(() => testCase(stringToString, stringToString, "ten")),
    attempt(() => testCase(new Cell(1), new Cell(2), "3")),
    attempt(() => testCase(new Cell("one"), new Cell("two"), 3)),
  ];
  lines.push(label + ": " + results.join(" | "));
}

const createHolder = (item: Tree): Holder => new Holder(item);
const createSlot = (item: Tree): Slot => ({ item });
const createOuter = (item: Tree): Outer => new Outer(new Holder(item));
const createTuple = (item: Tree): [Tree, number] => [item, 0];
const createArray = (item: Tree): Tree[] => [item];
const createLinkedCells = (): Cell => new Cell(1, new Cell(2));
const createDial = (): Dial => new Dial();

for (const round of ["first round", "second round"]) {
  lines.push(round);

  runAliasCases<Holder>("instanceof", checkInstanceof, createHolder);
  runAliasCases<Holder>("type predicate", checkTypePredicate, createHolder);
  runAliasCases<Holder>("discriminant", checkDiscriminant, createHolder);
  runAliasCases<Holder>("in operator", checkInOperator, createHolder);
  runAliasCases<Holder>("assertion function", checkAssertion, createHolder);
  runAliasCases<Holder>("switch", checkSwitch, createHolder);
  runAliasCases<Holder>("switch (true)", checkSwitchTrue, createHolder);
  runAliasCases<Holder>("aliased condition", checkAliasedCondition, createHolder);
  runAliasCases<Holder>("early return", checkEarlyReturn, createHolder);
  runAliasCases<Holder>("one expression", checkAndUseInOneExpression, createHolder);

  runAliasCases<Holder>("call", changeInCall, createHolder);
  runAliasCases<Holder>("closure", changeInClosure, createHolder);
  runAliasCases<Holder>("method of the alias", changeInAliasMethod, createHolder);
  runAliasCases<Holder>("method of the holder", changeInHolderMethod, createHolder);
  runAliasCases<Holder>("toString", changeInToString, createHolder);
  runAliasCases<Holder>("built-in callback", changeInBuiltinCallback, createHolder);
  runAliasCases<Holder>("between arguments", changeBetweenArguments, createHolder);
  runAliasCases<Holder>("inside the type predicate", changeInTypePredicate, createHolder);
  runAliasCases<Holder>("Object.assign", changeWithObjectAssign, createHolder);
  runAliasCases<Holder>("Reflect.set", changeWithReflectSet, createHolder);
  runAliasCases<Holder>("computed key", changeWithComputedKey, createHolder);
  runAliasCases<Holder>("destructuring", changeWithDestructuring, createHolder);
  runAliasCases<Holder>("yield", changeBetweenYields, createHolder);
  await runAliasCasesAsync("await", changeDuringAwait);

  runAliasCases<Holder>("this", thisProperty, createHolder);
  runAliasCases<Holder>("this, own method", thisPropertyOwnMethod, createHolder);
  runAliasCases<Slot>("object literal behind an interface", interfaceProperty, createSlot);
  runAliasCases<Slot>("class instance behind an interface", interfaceProperty, createHolder);
  runAliasCases<Outer>("nested property, last step", nestedPropertyLastStep, createOuter);
  runAliasCases<Outer>("nested property, first step", nestedPropertyFirstStep, createOuter);
  runAliasCases<[Tree, number]>("tuple element", tupleElement, createTuple);
  runAliasCases<Tree[]>("array element", arrayElement, createArray);
  runAliasCases<Tree[]>("array element after unshift", arrayElementAfterUnshift, createArray);
  runAliasCases<Tree[]>("array element after truncation", arrayElementAfterTruncation, createArray);
  runValuePairs("module const", moduleConstProperty);
  runValuePairs("reassigned module variable", reassignedModuleVariable);
  runValuePairs("static property", staticProperty);
  runValuePairs("local object", localObjectProperty);
  runValuePairs("captured object", capturedObjectProperty);

  runAliasCases<Holder>("all fields", readAllFields, createHolder);
  runAliasCases<Holder>("method only Leaf has", callLeafOnlyMethod, createHolder);
  runAliasCases<Holder>("typed parameter", passToTypedParameter, createHolder);
  runAliasCases<Holder>("typed field", storeToTypedField, createHolder);
  runAliasCases<Holder>("typed return", returnFromTypedFunction, createHolder);
  runAliasCases<Holder>("const", bindToConst, createHolder);
  runAliasCases<Holder>("typed array", pushToTypedArray, createHolder);

  runAliasCases<Holder>("check outside the loop", checkOutsideLoop, createHolder);
  runAliasCases<Holder>("check in the loop condition", checkInLoopCondition, createHolder);
  runAliasCases<Holder>("try", useInsideTry, createHolder);
  runAliasCases<Holder>("side effects", sideEffectsRunOnce, createHolder);
  lines.push("many holders: " + manyHolders(0) + " | " + manyHolders(3) + " | " + manyHolders(200));

  runValuePairs("class accessor", (first, second) => readAccessor(new Alternating(first, second)));
  runValuePairs("class accessor through this", (first, second) => new Alternating(first, second).readOwnAccessor());
  runValuePairs("class accessor behind an interface", (first, second) => readSlot(new Alternating(first, second)));
  runValuePairs("object literal accessor", (first, second) => readSlot(createAlternatingSlot(first, second)));

  runCellCases("number arithmetic", numberArithmetic);
  runCellCases("number method", numberMethod);
  runCellCases("string reads", stringReads);
  runCellCases("string method", stringMethod);
  runAliasedAndDistinct<Cell>("cleared after a truthy check", clearAfterTruthyCheck, createLinkedCells);
  runAliasedAndDistinct<Cell>("cleared after an undefined check", clearAfterUndefinedCheck, createLinkedCells);
  runAliasedAndDistinct<Cell>("cleared after an optional chain", clearAfterOptionalChain, createLinkedCells);
  runAliasedAndDistinct<Dial>("string literal", stringLiteralProperty, createDial);
  runAliasedAndDistinct<Dial>("enum", enumProperty, createDial);
  runAliasedAndDistinct<Dial>("boolean", booleanProperty, createDial);

  lines.push("wider box: " + attempt(() => storeThroughWiderBox(new Box(new Leaf("k")), new Branch([]))) + " | " + attempt(() => storeThroughWiderBox(new Box(new Leaf("l")), new Leaf("m"))));
  lines.push("wider array: " + attempt(() => storeThroughWiderArray([new Leaf("n")], new Branch([]))) + " | " + attempt(() => storeThroughWiderArray([new Leaf("o")], new Leaf("p"))));

  runAliasCases<Holder>("write through the property", writeThroughProperty, createHolder);
  runAliasCases<Holder>("delete", deleteProperty, createHolder);
  runValuePairs("getter defined over a field", (first, second) => readHolder(defineAlternatingGetter(first, second)));
  runValuePairs("proxy", (first, second) => readHolder(createAlternatingProxy(first, second)));
}

console.log(lines.join("\n"));

export {};
