// An object is made in front of a try. What throws inside makes nothing. In the handler, or behind the place where both ways meet,
// the object is given what the last node of a long list held, and the node lets go of it.
class Item {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

class Node {
  next: Node | null = null;
  item: Item | null = null;
}

class Owner {
  child: Item | null = null;
  round = 0;
}

class Sealed {
  #mark = 1;
  static read(object: any): number {
    return object.#mark;
  }
}

const head = new Node();
let last = head;
for (let i = 0; i < 400000; i++) {
  const node = new Node();
  last.next = node;
  last = node;
}

let caught: unknown = null;
let notes = 0;
function note(error: unknown): number {
  caught = error;
  notes++;
  return -1;
}

function arm(node: Node, round: number): void {
  node.item = new Item(round);
}

function throwsNumber(flag: boolean): number {
  if (flag) throw 7;
  return 1;
}

function behindTheJoin(node: Node, maybe: { x: number } | null, round: number): Owner {
  const owner = new Owner();
  let seen = 0;
  try {
    seen = maybe!.x;
  } catch (error) {
    seen = note(error);
  }
  owner.child = node.item;
  node.item = null;
  owner.round = round + seen + 1;
  return owner;
}

function inTheHandler(node: Node, maybe: { x: number } | null, round: number): Owner {
  const owner = new Owner();
  try {
    owner.round = maybe!.x;
  } catch (error) {
    note(error);
    owner.child = node.item;
    node.item = null;
    owner.round = round;
  }
  return owner;
}

function inTheCleanup(node: Node, maybe: { x: number } | null, round: number): Owner {
  const owner = new Owner();
  try {
    try {
      owner.round = maybe!.x;
    } finally {
      owner.child = node.item;
      node.item = null;
    }
  } catch (error) {
    note(error);
    owner.round = round;
  }
  return owner;
}

let handedOver: Owner | null = null;
function inACleanupThatThrowsOn(node: Node, maybe: { x: number } | null, round: number): void {
  const owner = new Owner();
  try {
    owner.round = maybe!.x;
  } finally {
    owner.child = node.item;
    node.item = null;
    owner.round = round;
    handedOver = owner;
  }
}
(globalThis as any).foundAtRunTime = inACleanupThatThrowsOn;

function behindABrandCheck(node: Node, other: object, round: number): Owner {
  const owner = new Owner();
  let seen = 0;
  try {
    seen = Sealed.read(other);
  } catch (error) {
    seen = note(error);
  }
  owner.child = node.item;
  node.item = null;
  owner.round = round + seen + 1;
  return owner;
}

function behindAnEarlyRead(node: Node, round: number): Owner {
  const owner = new Owner();
  let seen = 0;
  try {
    // @ts-expect-error
    seen = late;
    let late = 1;
    seen += late;
  } catch (error) {
    seen = note(error);
  }
  owner.child = node.item;
  node.item = null;
  owner.round = round + seen + 1;
  return owner;
}

function behindACalleeThatThrowsANumber(node: Node, round: number): Owner {
  const owner = new Owner();
  let seen = 0;
  try {
    seen = throwsNumber(round >= 0);
  } catch (error) {
    seen = note(error);
  }
  owner.child = node.item;
  node.item = null;
  owner.round = round + seen + 1;
  return owner;
}

function behindADetachedView(node: Node, view: Uint8Array, round: number): Owner {
  const owner = new Owner();
  let seen = 0;
  try {
    seen = view.fill(1).length;
  } catch (error) {
    seen = note(error);
  }
  owner.child = node.item;
  node.item = null;
  owner.round = round + seen + 1;
  return owner;
}

async function behindARejection(node: Node, maybe: { x: number } | null, round: number): Promise<Owner> {
  const owner = new Owner();
  let seen = 0;
  try {
    seen = await readLater(maybe);
  } catch (error) {
    seen = note(error);
  }
  owner.child = node.item;
  node.item = null;
  owner.round = round + seen + 1;
  return owner;
}

async function readLater(maybe: { x: number } | null): Promise<number> {
  return maybe!.x;
}

const nothing: { x: number } | null = process.env.SOMETHING ? { x: 1 } : null;
const detached = new Uint8Array(8);
structuredClone(detached.buffer, { transfer: [detached.buffer] });

const ring: (Owner | null)[] = new Array(256).fill(null);
let wrong = 0;
let made = 0;
function keep(owner: Owner, round: number): void {
  const old = ring[made & 255];
  if (old !== null && (old.child === null || old.child.value !== old.round)) wrong++;
  ring[made & 255] = owner;
  made++;
  if (owner.round !== round) wrong += 1000;
}

const rounds = 1500;
for (let round = 0; round < rounds; round++) {
  arm(last, round);
  keep(behindTheJoin(last, nothing, round), round);
  arm(last, round);
  keep(inTheHandler(last, nothing, round), round);
  arm(last, round);
  keep(inTheCleanup(last, nothing, round), round);
  arm(last, round);
  try {
    ((globalThis as any).foundAtRunTime as typeof inACleanupThatThrowsOn)(last, nothing, round);
  } catch (error) {
    note(error);
  }
  keep(handedOver!, round);
  arm(last, round);
  keep(behindABrandCheck(last, ring, round), round);
  arm(last, round);
  keep(behindAnEarlyRead(last, round), round);
  arm(last, round);
  keep(behindACalleeThatThrowsANumber(last, round), round);
  arm(last, round);
  keep(behindADetachedView(last, detached, round), round);
  arm(last, round);
  keep(await behindARejection(last, nothing, round), round);
}
for (const owner of ring) if (owner !== null && (owner.child === null || owner.child.value !== owner.round)) wrong++;
console.log(wrong, made, notes, caught instanceof Error ? caught.name : String(caught));
