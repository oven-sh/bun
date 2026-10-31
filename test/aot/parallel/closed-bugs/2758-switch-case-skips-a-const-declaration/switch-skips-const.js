function pick(n) {
  switch (n) {
    case 0:
      const x = "set";
      return () => x;
    case 1:
      const read = () => x;
      return read;
    default: {
      const inner = () => () => x;
      return inner();
    }
  }
}
for (const n of [0, 1, 2]) {
  try {
    console.log(n, pick(n)());
  } catch (error) {
    console.log(n, error.name);
  }
}
