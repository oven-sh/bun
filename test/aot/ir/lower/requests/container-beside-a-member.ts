// RUN: link
// CHECK-NOT: layout {{*}}name="Streams"{{*}}supertypes=
// CHECK: layout {{*}}name="Pipe"{{*}}supertypes=[
// CHECK-NOT: layout {{*}}name="Streams"{{*}}supertypes=

// RUN(SET): link
// SET: layout {{*}}name="Streams"

// Of the two that the union names, the Pipe goes in as a Stream and the Streams as a Set, which has no family.
class Stream {
  name = "";
}

class Streams extends Set<Stream> {}

class Pipe {
  name = "pipe";
}

export function hold(held: Pipe | Streams) {
  return held as Stream | Set<Stream>;
}

export const kept = [hold(new Pipe()), hold(new Streams())];
