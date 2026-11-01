// Saves the own properties of an object, of every function reachable from it and of their prototypes, to put them back.

const shapesOf: (objects: object[]) => unknown[] = $newCppFunction(
  "TestEnvironment.cpp",
  "jsFunctionShapesOfObjects",
  1,
);
const indexesOfChanged: (objects: object[], shapes: unknown[]) => number[] = $newCppFunction(
  "TestEnvironment.cpp",
  "jsFunctionIndexesOfChangedObjects",
  2,
);
// Also deletes a property that isn't configurable.
const deleteOwnProperty: (object: object, key: PropertyKey) => boolean = $newCppFunction(
  "TestEnvironment.cpp",
  "jsFunctionDeleteOwnProperty",
  2,
);

// This module is evaluated before any test file runs. Test files can patch builtins later,
// so only use what's captured here, $-private names, index loops and null-prototype descriptors.
const { getPrototypeOf, getOwnPropertyDescriptor, defineProperty, isExtensible } = Object;
const { ownKeys } = Reflect;

type Properties = Map<PropertyKey, PropertyDescriptor>;
export type KeyFilter = (object: object, key: PropertyKey) => boolean;

function getDescriptor(object: object, key: PropertyKey): PropertyDescriptor | undefined {
  const descriptor = getOwnPropertyDescriptor(object, key);
  return descriptor && ({ __proto__: null, ...descriptor } as PropertyDescriptor);
}

// `current` inherits from Object.prototype, which a test file may have added to.
function isSame(current: PropertyDescriptor, saved: PropertyDescriptor) {
  const x = $getByIdDirect(current, "value");
  const y = saved.value;
  return (
    (x === y ? x !== 0 || 1 / x === 1 / y : x !== x && y !== y) &&
    $getByIdDirect(current, "get") === saved.get &&
    $getByIdDirect(current, "set") === saved.set &&
    $getByIdDirect(current, "writable") === saved.writable &&
    $getByIdDirect(current, "enumerable") === saved.enumerable &&
    $getByIdDirect(current, "configurable") === saved.configurable
  );
}

// Visits `root`, every function reachable from it and their prototypes, each once. The global object only as the root.
function walk(
  root: object,
  descendsIntoObjects: boolean,
  isTracked: KeyFilter | undefined,
  seen: Map<object, true>,
  found: (object: object) => Properties | undefined,
) {
  function visit(object: object, descendsIntoObjects: boolean) {
    if (seen.$has(object) || (object === globalThis && object !== root)) return;
    seen.$set(object, true);
    const properties = found(object);
    const keys = ownKeys(object);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (isTracked && !isTracked(object, key)) continue;
      const descriptor = getDescriptor(object, key);
      if (!descriptor) continue;
      properties?.$set(key, descriptor);
      const { value, get, set } = descriptor;
      if (
        typeof value === "function" ||
        (typeof value === "object" && value !== null && (descendsIntoObjects || key === "prototype"))
      )
        visit(value, false);
      if (get) visit(get, false);
      if (set) visit(set, false);
    }
    const prototype = getPrototypeOf(object);
    if (prototype) visit(prototype, false);
  }
  visit(root, descendsIntoObjects);
}

function restoreProperties(
  object: object,
  properties: Properties,
  isTracked: KeyFilter | undefined,
  isLeftAlone: KeyFilter | undefined,
) {
  const keys = ownKeys(object);
  let found = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const saved = properties.$get(key);
    if (saved) found++;
    if (isLeftAlone?.(object, key)) continue;
    if (!saved) {
      if (!isTracked || isTracked(object, key)) deleteOwnProperty(object, key);
      continue;
    }
    const current = getOwnPropertyDescriptor(object, key)!;
    if (isSame(current, saved)) continue;
    if (!$getByIdDirect(current, "configurable")) {
      // A sealed or frozen object keeps its properties: one that is deleted can't be defined again.
      if (!isExtensible(object)) continue;
      if (saved.configurable) deleteOwnProperty(object, key);
      // Some builtins have a read-only property that gives a new value each time it's read.
      else if (!$getByIdDirect(current, "writable")) continue;
    }
    defineProperty(object, key, saved);
  }
  if (found === properties.$size || !isExtensible(object)) return;
  properties.$forEach((saved, key) => {
    if (!getOwnPropertyDescriptor(object, key)) defineProperty(object, key, saved);
  });
}

class SavedProperties {
  #isTracked: KeyFilter | undefined;
  #objects: object[] = [];
  #properties: Properties[] = [];
  #seen = new $Map<object, true>();
  // Nearly all of the objects are untouched by a test file. Native code tells which ones may not be.
  #shapes: unknown[] = [];
  #alwaysComparedCount = 0;

  // `isTracked` says which properties to save, and which to delete when a file added them.
  constructor(isTracked?: KeyFilter) {
    this.#isTracked = isTracked;
  }

  // Saves what is reachable from `root` and not saved yet. A walk that a proxy's trap stops saves nothing.
  save(root: object, descendsIntoObjects: boolean) {
    if (this.#seen.$has(root)) return;
    const objects = this.#objects;
    const properties = this.#properties;
    const start = objects.length;
    try {
      walk(root, descendsIntoObjects, this.#isTracked, this.#seen, object => {
        const saved: Properties = new $Map();
        $arrayPush(objects, object);
        $arrayPush(properties, saved);
        return saved;
      });
    } catch (error) {
      for (let i = start; i < objects.length; i++) this.#seen.$delete(objects[i]);
      objects.length = start;
      properties.length = start;
      throw error;
    }
    this.#saveShapes();
  }

  // Forgets what isn't reachable from `root`. The rest keeps its saved properties.
  keepReachableFrom(root: object, descendsIntoObjects: boolean) {
    this.restore();
    const reachable = new $Map<object, true>();
    walk(root, descendsIntoObjects, this.#isTracked, reachable, () => undefined);
    const objects = this.#objects;
    const properties = this.#properties;
    let kept = 0;
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      if (!reachable.$has(object)) {
        this.#seen.$delete(object);
        continue;
      }
      objects[kept] = object;
      properties[kept] = properties[i];
      kept++;
    }
    objects.length = kept;
    properties.length = kept;
    this.#saveShapes();
  }

  // Puts back every saved property that changed, and deletes those that were added. `isLeftAlone` names the exceptions.
  restore(isLeftAlone?: KeyFilter) {
    const objects = this.#objects;
    const changed = indexesOfChanged(objects, this.#shapes);
    for (let i = 0; i < changed.length; i++) {
      const index = changed[i];
      try {
        restoreProperties(objects[index], this.#properties[index], this.#isTracked, isLeftAlone);
      } catch {}
    }
    // A property that was deleted and put back is in another slot.
    if (changed.length !== this.#alwaysComparedCount) this.#saveShapes();
  }

  #saveShapes() {
    this.#shapes = shapesOf(this.#objects);
    this.#alwaysComparedCount = indexesOfChanged(this.#objects, this.#shapes).length;
  }
}

export default SavedProperties;
