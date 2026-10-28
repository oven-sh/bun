// A comparison that only folding decides leaves an async function without a caller. It stores an object in a variable that may hold null, calls a method of it right behind, and stores into a variable nobody reads.
type Manager = { count(): number };

let manager: Manager | null = null;
let lastCount = 0;

async function create(): Promise<Manager> {
  return {
    count() {
      return 7;
    },
  };
}
function stop() {
  manager = null;
}
async function start() {
  manager = await create();
  const count = manager.count();
  lastCount = count;
  console.log(count);
  if (count > 3) stop();
}

if ("abc".length > 10) await start();
console.log(manager, (await create()).count());
export {};
