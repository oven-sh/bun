function f(list: number[], tables: number[][]): string {
  const out: string[] = [], table = tables[0];
  for (const key in list) {
    let picked: any = key;
    switch (table[key as any]) { case 1: picked = "one"; break; case 2: picked = "two"; break; }
    out.push(typeof picked + picked);
  }
  return out.join();
}
console.log(f(JSON.parse("[7,8,9]"), JSON.parse("[[1,5,2]]")));
