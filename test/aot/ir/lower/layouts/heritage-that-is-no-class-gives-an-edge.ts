// RUN: link
// A class whose heritage is a value with a construct signature passes for what that signature constructs, and what passes for an
// interface passes for what the interface extends: the names cannot say so, because the methods lie in prototypes.
// A layout lists the nearest: `Socket` lists `SocketBase`, which lists `StreamLike`.
// CHECK: layout [[socket]] kind=Instance name="Socket" {{*}}supertypes=[{{*}}[[socketBase]]] flags=[HasHeritage]
// CHECK: layout [[socketBase]] {{*}}fields=[{key="bump" {{*}}, {key="destroySoon" {{*}}}] supertypes=[{{*}}[[streamLike]]] flags=[IsNeverAllocated]
// CHECK: layout [[streamLike]] {{*}}fields=[{key="bump" {{*}}}] flags=[IsNeverAllocated]
// RUN(NEAREST): link
// NEAREST-NOT: layout {{*}}name="Socket" {{*}}supertypes=[{{*}}, {{*}}] flags=[HasHeritage]
interface StreamLike {
  bump(): number;
}
interface SocketBase extends StreamLike {
  destroySoon(): void;
}
declare const Base: { new (): SocketBase; prototype: any };
const Derived = class Socket extends Base {
  extra = 1;
};
export function read(stream: StreamLike): number {
  return stream.bump();
}
export const made = read(new Derived());
