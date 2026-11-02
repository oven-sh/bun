// RUN: lower
// CHECK-LABEL: function {{*}}name="asserted"
// CHECK: = NewObject layout=[[built]]
// CHECK-LABEL: function {{*}}name="functionOfTheProgram"
// CHECK-NOT: layout=[[built]]
// CHECK: Return
// CHECK-LABEL: function {{*}}name="sameNames"
// CHECK: = NewObject -, {{*}}layout=[[both]] fields=[0, 1]
// CHECK-LABEL: function {{*}}name="typeOfTheCall"
// CHECK: = NewObject -, {{*}}layout=[[both]] fields=[0]
// CHECK-LABEL: function {{*}}name="writtenUnder"
// CHECK: = NewObject layout=[[built]]

interface Built {
  name: string;
  size: number;
  isEnabled(): boolean;
}

const DEFAULTS = { isEnabled: () => true };

export function asserted(given: { name: string; size: number }) {
  return Object.assign(Object.defineProperties({ ...DEFAULTS }, Object.getOwnPropertyDescriptors(given)), { size: 1 }) as unknown as Built;
}

export function writtenUnder(given: { name: string; size: number }): Built {
  const built: Built = Object.freeze(Object.assign({ ...DEFAULTS }, given));
  return built;
}

export function typeOfTheCall(a: number, b: number) {
  return Object.assign({ alpha: a }, { beta: b });
}

export function sameNames(a: number, b: number) {
  return { alpha: a, beta: b };
}

function assign<T>(target: T, _source: unknown): T {
  return target;
}

export function functionOfTheProgram(given: { name: string; size: number }) {
  return assign({ ...DEFAULTS }, given) as unknown as Built;
}
