// `Kit.version = 4` behind `class Kit {}`: the program itself adds the member to the class object, so a read of it is not predicted to find nothing.
// IR= 0 loopClass AreMembersUnchanged

class Kit {
  constructor(public size: number) {}
}
declare namespace Kit {
  const version: 4;
  function twice(n: number): number;
}
(Kit as any).version = 4;
(Kit as any).twice = function twice(n: number): number {
  return n * 2;
};

function loopClass(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + Kit.twice(i & 7) + Kit.version) | 0;
  return sum + new Kit(2).size;
}

console.log(loopClass(100));
