// An enum of one clause of a switch. A later clause that is entered directly reads a member: plain Bun puts the value in place, so that read does not throw. An earlier clause reads the object, which is not there yet.
function attempt(read: () => unknown) {
  try {
    return read();
  } catch (error) {
    return (error as Error).name;
  }
}
function pick(n: number) {
  switch (n) {
    case 0:
      return () => E.A;
    case 1:
      enum E {
        A = 5,
      }
      return E.A;
    case 2:
      return E.A;
  }
}
console.log(
  pick(1),
  pick(2),
  attempt(() => (pick(0) as () => unknown)()),
);
