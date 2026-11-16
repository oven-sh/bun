interface Dog {
  kind: "dog";
  barks: number;
}
interface Cat {
  kind: "cat";
  lives: number;
}
interface Fish {
  kind: "fish";
}
type Pet = Dog | Cat | Fish | undefined;
function score(pet: Pet): number {
  if (pet === undefined) return 0;
  if (pet.kind === "dog") return pet.barks + 1;
  if (pet.kind === "cat") return pet.lives * 10;
  return 100;
}
const pets: Pet[] = [{ kind: "dog", barks: 2 }, { kind: "cat", lives: 9 }, undefined, { kind: "fish" }];
let total = 0;
for (let i = 0; i < pets.length; i++) {
  const pet = pets[i];
  total += score(pet);
  console.log(i, pet?.kind, total);
}
