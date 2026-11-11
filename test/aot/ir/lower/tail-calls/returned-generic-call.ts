// RUN(BOUNDED): lower
// BOUNDED-LABEL: function {{*}}name="bounded"
// BOUNDED: results=[{type=undefined|null|[[square]] flags=[OmitsNull, OmitsUndefined]}]
// BOUNDED: [[call]] = Call {{*}}calleeName="largest"
// BOUNDED-NEXT: ReturnCall [[call]] casts=[{declared={type=undefined|null|[[square]] flags=[IsExpected, OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[square]] flags=[OmitsNull, OmitsUndefined]}}]

// RUN(LISTS): lower
// LISTS-LABEL: function {{*}}name="lists"
// LISTS: results=[{type=undefined|null|Array<undefined|null|[[square]]> flags=[OmitsNull, OmitsUndefined]}]
// LISTS: [[call]] = Call {{*}}calleeName="keep"
// LISTS-NEXT: ReturnCall [[call]] casts=[{declared={type=undefined|null|Array<undefined|null|[[square]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|[[square]]> flags=[OmitsNull, OmitsUndefined]}}]

// RUN(WRITTEN): lower
// WRITTEN-LABEL: function {{*}}name="written"
// WRITTEN: [[call]] = Call {{*}}calleeName="largest"
// WRITTEN-NEXT: ReturnCall [[call]] casts=[{declared={type=undefined|null|[[square]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[square]] flags=[OmitsNull, OmitsUndefined]}}]

// RUN(RECEIVER): lower
// RECEIVER-LABEL: function {{*}}name="ofReceiver"
// RECEIVER: [[call]] = Call {{*}}calleeName="box.get"
// RECEIVER-NEXT: ReturnCall [[call]] casts=[{declared={type=undefined|null|[[square]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[square]] flags=[OmitsNull, OmitsUndefined]}}]

// RUN(WIDER): lower
// WIDER-LABEL: function {{*}}name="wider"
// WIDER: [[call]] = Call {{*}}calleeName="largest"
// WIDER-NEXT: ReturnCall [[call]] casts=[{declared={type=undefined|null|L{{*}} flags=[IsExpected, OmitsNull, OmitsUndefined]}}] @

// RUN(PLAIN): lower
// PLAIN-LABEL: function {{*}}name="plain"
// PLAIN: [[call]] = Call {{*}}calleeName="make"
// PLAIN-NEXT: ReturnCall [[call]] casts=[{declared={type=undefined|null|[[square]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[square]] flags=[OmitsNull, OmitsUndefined]}}]

// RUN(PROGRAM): lower
// PROGRAM-LABEL: function {{*}}name="ofProgram"
// PROGRAM: results=[{type=undefined|null|[[square]] flags=[OmitsNull, OmitsUndefined]}]
// PROGRAM: [[call]] = Call {{*}}calleeName="smallest"
// PROGRAM-NEXT: ReturnCall [[call]] casts=[{declared={type=undefined|null|[[square]] flags=[OmitsNull, OmitsUndefined]}}] @

// RUN(NEITHER): lower
// NEITHER-LABEL: function {{*}}name="ofProgramWider"
// NEITHER: [[call]] = Call {{*}}calleeName="smallest"
// NEITHER-NEXT: ReturnCall [[call]] @

// The casts of a returned call are what the call itself says and, behind it, the result of the function around it. A call says something only of code that is not in the program, here declarations without a body. The engine sees what `smallest` returns, so a call of it has the cast of the function around it and no other. Where the call stays a tail call the engine tests none of them, and the caller tests what arrives. Where it does not, they are conversions in their order. What the call says is the type that the checker has for this call, never the bound, which says less. A type argument that somebody wrote, at the call or with the type of the receiver, is a written type like any other. One that only the checker put there is expected and no more, as a bare `T` always was: the cast behind it tests as much, and in `wider`, where it says less, nobody reads a proof behind the return.
interface Shape {
  side: number;
}

interface Square {
  corners: number;
  side: number;
}

declare class Box<T> {
  get(): T;
}

declare function make(): Square;

declare function keep<T>(list: T[]): T[];

declare function largest<T extends Shape>(list: T[]): T;

function smallest<T extends Shape>(list: T[]): T {
  return list[0];
}

export function bounded(squares: Square[]): Square {
  return largest(squares);
}

export function lists(squares: Square[]): Square[] {
  return keep(squares);
}

export function ofReceiver(box: Box<Square>): Square {
  return box.get();
}

export function wider(squares: Square[]): unknown {
  return largest(squares);
}

export function written(squares: Square[]): Square {
  return largest<Square>(squares);
}

export function plain(): Square {
  return make();
}

export function ofProgram(squares: Square[]): Square {
  return smallest(squares);
}

export function ofProgramWider(squares: Square[]): unknown {
  return smallest(squares);
}
