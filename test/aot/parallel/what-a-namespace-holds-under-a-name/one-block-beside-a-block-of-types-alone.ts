namespace Later.Inner { export type Kind = number; }
namespace Later { export const held: Inner.Kind = 3; }
console.log(JSON.stringify(Later), Object.keys(Later).join(), "held" in Later);
for (const k in Later) console.log(k);
