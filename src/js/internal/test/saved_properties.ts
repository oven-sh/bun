// Saves the own properties of an object and of what walk() reaches from it, to put them back.

// The second argument lists the objects to take out of dictionary mode first: a delete can leave one in it.
const shapesOf: (objects: object[], lostProperties?: number[]) => unknown[] = $newCppFunction(
  "TestEnvironment.cpp",
  "jsFunctionShapesOfObjects",
  2,
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
const { getPrototypeOf, setPrototypeOf, getOwnPropertyDescriptor, defineProperty, isExtensible } = Object;
const { ownKeys } = Reflect;

type Properties = Map<PropertyKey, PropertyDescriptor>;
export type KeyFilter = (object: object, key: PropertyKey) => boolean;
export type Objects = Map<object, true>;

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

// Visits `root`, its objects, the functions they reach and their prototypes. `globalThis` only as the root, and nothing in `others`.
function walk(
  root: object,
  isTracked: KeyFilter,
  others: Objects | undefined,
  seen: Objects,
  found: (object: object, prototype: object | null) => Properties | undefined,
) {
  function visit(object: object) {
    if (seen.$has(object) || (object === globalThis && object !== root) || others?.$has(object)) return;
    seen.$set(object, true);
    const prototype = getPrototypeOf(object);
    const properties = found(object, prototype);
    const keys = ownKeys(object);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!isTracked(object, key)) continue;
      const descriptor = getDescriptor(object, key);
      if (!descriptor) continue;
      properties?.$set(key, descriptor);
      const { value, get, set } = descriptor;
      if (
        typeof value === "function" ||
        (typeof value === "object" && value !== null && (object === root || key === "prototype"))
      )
        visit(value);
      if (get) visit(get);
      if (set) visit(set);
    }
    if (prototype) visit(prototype);
  }
  visit(root);
}

function ownProperties(object: object, isTracked: KeyFilter) {
  const properties: Properties = new $Map();
  const keys = ownKeys(object);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!isTracked(object, key)) continue;
    const descriptor = getDescriptor(object, key);
    if (descriptor) properties.$set(key, descriptor);
  }
  return properties;
}

// Returns whether it deleted a property.
function restoreProperties(
  object: object,
  properties: Properties,
  isTracked: KeyFilter,
  isLeftAlone: KeyFilter | undefined,
) {
  const keys = ownKeys(object);
  let found = 0;
  let deleted = false;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const saved = properties.$get(key);
    if (saved) found++;
    if (isLeftAlone?.(object, key)) continue;
    if (!saved) {
      if (isTracked(object, key) && deleteOwnProperty(object, key)) deleted = true;
      continue;
    }
    const current = getOwnPropertyDescriptor(object, key)!;
    if (isSame(current, saved)) continue;
    if (!$getByIdDirect(current, "configurable")) {
      // A sealed or frozen object keeps its properties: one that is deleted can't be defined again.
      if (!isExtensible(object)) continue;
      if (saved.configurable) deleted = deleteOwnProperty(object, key) || deleted;
      // Some builtins have a read-only property that gives a new value each time it's read.
      else if (!$getByIdDirect(current, "writable")) continue;
    }
    defineProperty(object, key, saved);
  }
  if (found === properties.$size || !isExtensible(object)) return deleted;
  properties.$forEach((saved, key) => {
    if (!getOwnPropertyDescriptor(object, key)) defineProperty(object, key, saved);
  });
  return deleted;
}

class SavedProperties {
  #isTracked: KeyFilter;
  #others: Objects | undefined;
  #objects: object[] = [];
  #properties: Properties[] = [];
  #prototypes: (object | null)[] = [];
  // Nearly all of the objects are untouched by a test file. Native code tells which ones may not be.
  #shapes: unknown[] = [];
  #alwaysComparedCount = 0;

  // `isTracked` says which properties to save, and which to delete when a file added them. What `others` has is left to another set.
  constructor(isTracked: KeyFilter, others?: Objects) {
    this.#isTracked = isTracked;
    this.#others = others;
  }

  // Saves what is reachable from `root`, and returns those objects. A walk that a proxy's trap stops saves nothing.
  save(root: object) {
    const objects: object[] = [];
    const properties: Properties[] = [];
    const prototypes: (object | null)[] = [];
    const seen: Objects = new $Map();
    walk(root, this.#isTracked, this.#others, seen, (object, prototype) => {
      const saved: Properties = new $Map();
      $arrayPush(objects, object);
      $arrayPush(properties, saved);
      $arrayPush(prototypes, prototype);
      return saved;
    });
    this.#objects = objects;
    this.#properties = properties;
    this.#prototypes = prototypes;
    this.#saveShapes();
    return seen;
  }

  // Forgets what isn't reachable from `root`. Of the rest, what changed since the last save or restore is saved as it is now.
  keepReachableFrom(root: object) {
    const reachable: Objects = new $Map();
    walk(root, this.#isTracked, this.#others, reachable, () => undefined);
    this.#saveChanged(reachable);
    const objects = this.#objects;
    const properties = this.#properties;
    const prototypes = this.#prototypes;
    let kept = 0;
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      if (!reachable.$has(object)) continue;
      objects[kept] = object;
      properties[kept] = properties[i];
      prototypes[kept] = prototypes[i];
      kept++;
    }
    objects.length = kept;
    properties.length = kept;
    prototypes.length = kept;
    this.#saveShapes();
  }

  // Saves what changed since the last save or restore as it is now.
  saveChanges() {
    this.#saveChanged();
    this.#saveShapes();
  }

  // Puts back every saved property that changed, and deletes those that were added. `isLeftAlone` names the exceptions.
  restore(isLeftAlone?: KeyFilter) {
    const objects = this.#objects;
    const changed = indexesOfChanged(objects, this.#shapes);
    let lostProperties: number[] | undefined;
    for (let i = 0; i < changed.length; i++) {
      const index = changed[i];
      const object = objects[index];
      try {
        if (restoreProperties(object, this.#properties[index], this.#isTracked, isLeftAlone))
          $arrayPush((lostProperties ??= []), index);
        if (getPrototypeOf(object) !== this.#prototypes[index]) setPrototypeOf(object, this.#prototypes[index]);
      } catch {}
    }
    // A property that was put back can be in another slot. A class also gets another structure when it is first used.
    if (lostProperties || changed.length !== this.#alwaysComparedCount) this.#saveShapes(lostProperties);
  }

  #saveChanged(only?: Objects) {
    const objects = this.#objects;
    const changed = indexesOfChanged(objects, this.#shapes);
    for (let i = 0; i < changed.length; i++) {
      const index = changed[i];
      const object = objects[index];
      if (only && !only.$has(object)) continue;
      try {
        const properties = ownProperties(object, this.#isTracked);
        this.#prototypes[index] = getPrototypeOf(object);
        this.#properties[index] = properties;
      } catch {}
    }
  }

  #saveShapes(lostProperties?: number[]) {
    this.#shapes = shapesOf(this.#objects, lostProperties);
    this.#alwaysComparedCount = indexesOfChanged(this.#objects, this.#shapes).length;
  }
}

export default SavedProperties;
