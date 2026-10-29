function run(argument: string): void {
  interface Node {
    children?: number[];
  }
  const nodes: Node[] = [{ children: [1, 2] }, {}];
  function count(n: Node): number {
    try {
      return n.children!.length;
    } catch (e) {
      return -1;
    }
  }
  console.log(count(nodes[Number(argument ?? 0)]));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
