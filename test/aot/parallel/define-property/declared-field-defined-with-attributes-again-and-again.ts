// A declared field is defined with attributes that its slot does not have, on one object after another of the same shape: each object ends up as the first did.
type Target = { hidden?: number | string; shown: number; last?: number };

function describe(target: Target): string {
  const descriptors = Object.getOwnPropertyDescriptors(target) as Record<string, PropertyDescriptor>;
  return JSON.stringify([
    Reflect.ownKeys(target),
    Object.keys(target),
    Object.entries(descriptors).map(([name, d]) => [
      name,
      "value" in d ? d.value : typeof d.get,
      d.writable,
      d.enumerable,
      d.configurable,
    ]),
    JSON.stringify(target),
    target.hidden,
    "hidden" in target,
  ]);
}

function attempt(action: () => unknown): string {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

function notEnumerable(i: number): Target {
  const target: Target = { shown: 1 };
  Object.defineProperty(target, "hidden", { value: i, enumerable: false });
  return target;
}
function onlyWritable(i: number): Target {
  const target: Target = { shown: 1 };
  Object.defineProperty(target, "hidden", { value: i, writable: true });
  return target;
}
function onlyConfigurable(i: number): Target {
  const target: Target = { shown: 1 };
  Object.defineProperty(target, "hidden", { value: i, configurable: true, enumerable: true });
  return target;
}
function accessor(i: number): Target {
  const target: Target = { shown: 1 };
  Object.defineProperty(target, "hidden", { get: () => i * 2, configurable: true });
  return target;
}
function overAValue(i: number): Target {
  const target: Target = { hidden: i, shown: 1 };
  Object.defineProperty(target, "hidden", { value: i + 1, enumerable: false });
  return target;
}
function attributesAlone(i: number): Target {
  const target: Target = { hidden: i, shown: 1 };
  Object.defineProperty(target, "hidden", { writable: false });
  return target;
}
function thenAnotherField(i: number): Target {
  const target: Target = { shown: 1 };
  Object.defineProperty(target, "hidden", { value: i, enumerable: false });
  target.last = i;
  return target;
}
function behindAnotherField(i: number): Target {
  const target: Target = { shown: 1 };
  target.last = i;
  Object.defineProperty(target, "hidden", { value: i, enumerable: false });
  return target;
}
function storedOtherType(i: number): Target {
  const target: Target = { shown: 1 };
  (target as any).hidden = { boxed: i };
  return target;
}
function twoDefinitions(i: number): Target {
  const target: Target = { shown: 1 };
  Object.defineProperty(target, "hidden", { value: i, configurable: true });
  Object.defineProperty(target, "last", { value: i, enumerable: false, writable: true });
  return target;
}
function frozenFirst(i: number): Target {
  const target: Target = Object.preventExtensions({ shown: 1 });
  attempt(() => Object.defineProperty(target, "hidden", { value: i, enumerable: false }));
  return target;
}

const makers = [
  notEnumerable,
  onlyWritable,
  storedOtherType,
  onlyConfigurable,
  accessor,
  overAValue,
  attributesAlone,
  thenAnotherField,
  behindAnotherField,
  twoDefinitions,
  frozenFirst,
];

// Each maker alone, so that what the first object left behind serves the next ones.
for (const make of makers) {
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) seen.add(describe(make(7)));
  console.log(make.name, seen.size, [...seen][0]);
}

// In turns, so that each finds what another maker left behind for the same shape and name.
const mixed = new Map<string, Set<string>>();
for (let i = 0; i < 60; i++) {
  if (i === 30) Bun.gc(true);
  for (const make of makers) {
    let seen = mixed.get(make.name);
    if (!seen) mixed.set(make.name, (seen = new Set()));
    seen.add(describe(make(7)));
  }
}
for (const [name, seen] of mixed) console.log(name, seen.size, [...seen][0]);

// What the attributes forbid stays forbidden on the tenth object as on the first.
for (let i = 0; i < 10; i++) {
  const fixed = notEnumerable(i);
  const loose = onlyConfigurable(i);
  const line = [
    attempt(() => {
      "use strict";
      fixed.hidden = 5;
      return fixed.hidden;
    }),
    attempt(() => delete fixed.hidden),
    attempt(() => Object.defineProperty(fixed, "hidden", { value: 9 }).hidden),
    attempt(() => Object.defineProperty(fixed, "hidden", { value: i }).hidden),
    attempt(() => delete loose.hidden),
    attempt(() => ((loose.hidden = 3), describe(loose))),
  ];
  if (i === 0 || i === 9) console.log(i, line.join(" | "));
}
