// RUN: lower
// OPTIONS: builtin-modules

// A closure in a literal is called after an await inside an async context.
import { AsyncLocalStorage } from "node:async_hooks";

const journeys = new AsyncLocalStorage();

async function sail({ tide, weight, openGate, load, ship, stopped }) {
  const gate = await openGate();
  if (!tide || stopped.yes) throw new Error("the ship stays");
  return load(weight, gate, ship);
}

async function voyage(ship, charges, tide) {
  const stopped = { yes: false };
  let gate;
  const openGate = () => {
    if (gate === undefined)
      gate = (async () => {
        if (stopped.yes) throw new Error("the gate stays shut");
        return { charges, ship, tide };
      })();
    return gate;
  };
  const load = async (weight, opened, loaded) => {
    const sum = opened.ship.id + loaded.id + weight + ship.id + (charges.extra ?? 0);
    if (stopped.yes) throw new Error("nothing is loaded");
    return sum;
  };
  const begun = { openGate, ship };
  const leave = ({ weight }) =>
    journeys.run({ ...begun, weight }, () => sail({ tide, weight, openGate, load, ship, stopped }));
  return await leave({ weight: 1 });
}

const rounds = Number(process.env.ROUNDS ?? 2000);
let total = 0;
for (let round = 0; round < rounds; round++) {
  const ships = [];
  for (let i = 0; i < 16; i++) ships.push(voyage({ id: i, name: "ship " + round }, {}, { round }));
  for (const value of await Promise.all(ships)) total += value;
}
console.log(total);

// CHECK-LABEL: function {{*}}name="voyage"
// CHECK-LABEL: function {{*}}name="openGate"
// CHECK-LABEL: function {{*}}name="leave"
