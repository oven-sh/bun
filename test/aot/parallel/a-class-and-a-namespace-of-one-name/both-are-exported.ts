export class Position {
  static #known = new Map<number, Position>();
  constructor(readonly line: number) {}
  static at(line: number) {
    let found = Position.#known.get(line);
    if (!found) Position.#known.set(line, found = new Position(line));
    return found;
  }
}
export namespace Position {
  export function same(a: Position, b: Position) { return a === b; }
}
const line = Number(process.argv[2] ?? 3);
console.log(Position.same(Position.at(line), Position.at(line)), Position.at(line + 1).line);
