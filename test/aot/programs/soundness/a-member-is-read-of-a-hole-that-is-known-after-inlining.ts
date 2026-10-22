// The list has a hole. On that path the element is the constant undefined, and the test of the element is a load through it that faults.
// The error has to name undefined. The function with the read has no handler of its own: the caller catches.
interface Part {
  depth: number;
}
function tryAll(): string {
  let out = "";
  const uses: (() => unknown)[] = [
    () => 1,
    () => 2,
    () => 3,
    () => 4,
    () => {
      const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
      delete list[1];
      let total = 0;
      for (const part of list) total += part.depth;
      return total;
    },
  ];
  for (const use of uses) {
    try {
      out += String(use()) + ";";
    } catch (error) {
      out += (error as Error).constructor.name + " " + (error as Error).message.split(" ")[0] + ";";
    }
  }
  return out;
}
console.log("hole " + tryAll());
