class Creature {
  weight = 3;
}

class Cat extends Creature {
  lives = 9;
}

interface Keeper {
  feed(creature: Creature): number;
}

class CatKeeper implements Keeper {
  feed(cat: Cat): number {
    return cat.lives + cat.weight;
  }
}

function feedAll(keeper: Keeper, creatures: Creature[]): number {
  let total = 0;
  for (let i = 0; i < creatures.length; i++) total += keeper.feed(creatures[i]);
  return total;
}

function aMethodThatTakesTheNarrowerType(): () => number {
  const keeper = new CatKeeper();
  const cats: Cat[] = [];
  for (let i = 0; i < 100; i++) cats.push(new Cat());
  return function turnOfAMethodThatTakesTheNarrowerType() {
    return feedAll(keeper, cats);
  };
}

interface Tally {
  (amount: number): number;
  calls: number;
}

function useTally(tally: Tally): number {
  let total = 0;
  for (let i = 0; i < 100; i++) {
    total += tally(i);
    tally.calls = tally.calls + 1;
  }
  return total + tally.calls;
}

function aFunctionWithMembers(): () => number {
  const tally: Tally = Object.assign((amount: number) => amount * 2, { calls: 0 });
  return function turnOfAFunctionWithMembers() {
    return useTally(tally);
  };
}

export const cases = {
  "8 a method that takes the narrower type": aMethodThatTakesTheNarrowerType,
  "9 a function with members for a type with a call signature": aFunctionWithMembers,
};
