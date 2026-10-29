// Functions created at run time give arrays own members through the interpreter's cached transition: map, then, toJSON and a private name. No such array may still claim to be pristine. The build validates, so the full collection at the end checks every array that does.
// Flags: --aot-validate
type Store = (list: number[]) => void;

const host = globalThis as any;
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc;

// The interpreter caches a transition only where the storage for named properties does not grow, so `tag` is stored first.
const storing = (statement: string): any => new Function("list", "list.tag = 1; " + statement);
const stamp: any = (0, eval)(`(() => {
  class ReturnsArgument { constructor(object) { return object; } }
  class Stamp extends ReturnsArgument {
    #stamp = "stamped";
    static read(object) { return #stamp in object ? object.#stamp : "none"; }
  }
  return { add(list) { list.tag = 1; new Stamp(list); }, read: Stamp.read };
})()`);

const stores: [string, Store][] = [
  ["name that shadows nothing", storing("list.label = 'plain';")],
  ["map", storing("list.map = function (callback) { return [callback(-1, 0, this)]; };")],
  ["then", storing("list.then = function (resolve) { resolve([-1]); };")],
  ["toJSON", storing("list.toJSON = function () { return 'own toJSON'; };")],
  ["private name", stamp.add],
];

function double(list: number[]): string { return list.map(n => n * 2).join(); }
async function settle(list: number[]): Promise<string> { return (await list).join(); }
function write(list: number[]): string { return JSON.stringify(list); }

async function describe(list: number[]): Promise<string> {
  return [double(list), await settle(list), write(list), stamp.read(list), Object.keys(list).join()].join(" | ");
}

const kept: number[][] = [];
for (const [member, store] of stores) {
  for (let round = 1; round <= 3; round++) {
    const list = [1, 2, 3];
    const before = await describe(list);
    store(list);
    kept.push(list);
    console.log(member + ", array " + round + ": " + before + " => " + (await describe(list)));
  }
}

collect();
console.log("arrays alive during the collection: " + kept.length);
export {};
