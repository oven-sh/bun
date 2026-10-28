// RUN: link
// A class whose heritage is a value with a construct signature passes for what that signature constructs, and what passes for an
// interface passes for what the interface extends: the names cannot say so, because the methods lie in prototypes.
// CHECK: layout L0 kind=Instance name="Socket" {{*}}supertypes=[L1, L2]
// CHECK: layout L1 name="StreamLike"
// CHECK: layout L2 name="SocketBase" {{*}}supertypes=[L1]
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
