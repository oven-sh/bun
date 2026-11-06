// RUN: link
// CHECK: layout {{*}}name="Waiting"
// CHECK-NOT: supertypes=
// CHECK: layout {{*}}name="Stream"

// The object is a Set, so the Set of the union takes it. It does not go below the other member, whose fields it lacks.
interface Stream {
  listeners: number;
}

class Waiting extends Set<Stream> {}

interface State {
  waiting: Stream | Set<Stream> | null;
}

export function wait(state: State, stream: Stream) {
  state.waiting = new Waiting([stream]);
}
