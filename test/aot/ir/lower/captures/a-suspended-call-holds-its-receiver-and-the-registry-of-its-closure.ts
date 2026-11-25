// RUN: lower
// CHECK-LABEL: function {{*}}name="waitsBesideRegistry"
// CHECK-NEXT: b0([[waited]]: {{*}}, [[registry]]: anything, [[receiver]]: anything):
// CHECK-NEXT: = Await [[waited]], [[receiver]], [[registry]] @

// RUN(ENVIRONMENT): lower
// ENVIRONMENT-LABEL: function {{*}}name="stepsBesideRegistry"
// ENVIRONMENT-NEXT: b0([[environment]]: env {{*}}, [[receiver]]: anything, {{*}}):
// ENVIRONMENT-NEXT: InitialYield [[receiver]], [[environment]] @
// ENVIRONMENT: = Yield [[step]], [[receiver]], [[environment]] @

// RUN(LIST): lower
// LIST-LABEL: function {{*}}name="waitsBesideList"
// LIST-NEXT: b0([[list]]: {{*}}, [[waited]]: {{*}}, [[receiver]]: anything):
// LIST: = Await [[waited]], [[receiver]] @

// RUN(RECEIVER): lower
// RECEIVER-LABEL: function {{*}}name="waitsOnReceiver"
// RECEIVER-NEXT: b0([[receiver]]: {{*}}, [[waited]]: {{*}}):
// RECEIVER-NEXT: = Await [[waited]], [[waited]], [[receiver]] @

declare function hand(value: unknown): void;

export function holdsRegistry(note: (held: string) => void, waited: Promise<void>) {
  const registry = new FinalizationRegistry(note);
  hand((target: object) => registry.register(target, ""));
  return async function waitsBesideRegistry() {
    await waited;
  };
}

export function holdsEnvironmentOfRegistry(note: (held: string) => void) {
  let registry: FinalizationRegistry<string> | null = null;
  hand(() => (registry = new FinalizationRegistry(note)));
  return function* stepsBesideRegistry() {
    yield 1;
  };
}

export function holdsNothingElse(list: string[], waited: Promise<void>) {
  return async function waitsBesideList() {
    hand(list);
    await waited;
  };
}

export class Watcher {
  async waitsOnReceiver(waited: Promise<void>) {
    await waited;
  }
}
