// Copies between two layouts whose source has elements or not, in every order of turns: the plan of a source without elements serves no source with them.
interface Point { a: number; b: number; c?: string }
function digest(object: any): string {
  return Reflect.ownKeys(object).map(key => String(key) + "=" + String(object[key])).join();
}
function copy(source: any): Point { const point: Point = source; return { ...point }; }
function inFront(source: any): Point & { label: number } { const point: Point = source; return { ...point, label: 1 }; }
function behind(source: any): Point & { label: number } { const point: Point = source; return { label: 1, ...point }; }
function assigned(source: any): any { return Object.assign({ label: 1, a: 0 }, source); }
function empty(source: any): any { return Object.assign({}, source); }
function rest(source: any): any { const { a, ...others } = source as Point & Record<string, unknown>; return others; }
const plain = () => ({ a: 1, b: 2 });
const withElements = () => { const made: any = { a: 1, b: 2 }; made[0] = "zero"; return made; };
const literal = () => ({ a: 1, b: 2, 0: "zero" });
const lostElements = () => { const made: any = { a: 1, b: 2 }; made[0] = "zero"; delete made[0]; return made; };
const withName = () => { const made: any = { a: 1, b: 2 }; made.extra = "e"; made[1] = "one"; return made; };
const lostName = () => { const made: any = { a: 1, b: 2, 3: "three" }; made.extra = "e"; delete made.extra; return made; };
const frozen = () => Object.freeze(withElements());
const sealedPlain = () => Object.seal(plain());
const makers: Record<string, () => any> = { plain, withElements, literal, lostElements, withName, lostName, frozen, sealedPlain };
const ways: Record<string, (s: any) => any> = { copy, inFront, behind, assigned, empty, rest };
for (const [wayName, way] of Object.entries(ways)) {
  for (const [firstName, first] of Object.entries(makers)) {
    for (const [secondName, second] of Object.entries(makers)) {
      let out = "";
      for (let turn = 0; turn < 40; turn++) {
        out = digest(way(turn < 20 ? first() : second()));
        if (turn === 19) console.log(wayName, firstName, out);
      }
      console.log(wayName, firstName, secondName, out);
    }
  }
}
