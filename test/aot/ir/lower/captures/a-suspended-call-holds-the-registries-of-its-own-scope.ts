// RUN: lower
// CHECK-LABEL: function {{*}}name="waitsBesideItsOwnRegistry"
// CHECK-NEXT: b0([[receiver]]: anything, [[note]]: {{*}}, [[waited]]: {{*}}):
// CHECK-NEXT: [[environment]] = NewObject layout=L0 @
// CHECK: = Await [[waited]], [[note]], [[waited]], [[receiver]], [[environment]] @

// RUN(CONSTANT): lower
// CONSTANT-LABEL: function {{*}}name="waitsBesideItsOwnConstant"
// CONSTANT-NEXT: b0([[receiver]]: anything, [[note]]: {{*}}, [[waited]]: {{*}}):
// CONSTANT: [[made]] = Construct {{*}}calleeName="FinalizationRegistry"
// CONSTANT-NEXT: [[registry]] = Convert [[made]]
// CONSTANT: = Await [[waited]], [[note]], [[waited]], [[receiver]], [[registry]] @

// RUN(FRONT): lower
// FRONT-LABEL: function {{*}}name="waitsInFrontOfItsRegistry"
// FRONT-NEXT: b0([[receiver]]: anything, [[note]]: {{*}}, [[waited]]: {{*}}):
// FRONT-NEXT: = Await [[waited]], [[note]], [[waited]], [[receiver]] @

// RUN(LEFT): lower
// LEFT-LABEL: function {{*}}name="waitsBehindTheBlockOfARegistry"
// LEFT-NEXT: b0([[receiver]]: anything, [[note]]: {{*}}, [[waited]]: {{*}}, [[some]]: boolean):
// LEFT: = Await [[waited]], [[note]], [[waited]], [[some]], [[receiver]] @

declare function hand(value: unknown): void;

export async function waitsBesideItsOwnRegistry(note: (held: string) => void, waited: Promise<void>) {
  let registry: FinalizationRegistry<string> | null = null;
  let count = 0;
  function load() {
    registry = new FinalizationRegistry(note);
  }
  function bump() {
    return ++count;
  }
  load();
  await waited;
  return bump();
}

export async function waitsBesideItsOwnConstant(note: (held: string) => void, waited: Promise<void>) {
  const registry = new FinalizationRegistry(note);
  function look() {
    return registry !== null;
  }
  look();
  await waited;
}

export async function waitsInFrontOfItsRegistry(note: (held: string) => void, waited: Promise<void>) {
  await waited;
  const registry = new FinalizationRegistry(note);
  hand(() => registry);
}

export async function waitsBehindTheBlockOfARegistry(note: (held: string) => void, waited: Promise<void>, some: boolean) {
  if (some) {
    const registry = new FinalizationRegistry(note);
    hand(() => registry);
  }
  await waited;
}
