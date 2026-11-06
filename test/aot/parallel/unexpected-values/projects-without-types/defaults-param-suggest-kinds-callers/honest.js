import * as library from "./library.js";

export function honest() {
  return [
    library.next(1) + library.next(),
    library.half(4) + library.half(),
    library.bits(5) + library.bits(),
    library.size([1]) + library.size(),
    library.appended([1], 2).length + library.appended().length,
    library.shout("a") + library.shout(),
    library.glued("a", "b") + library.glued(),
    library.chosen(true) + library.chosen(),
    library.negated(true),
    library.width({ width: 3 }),
    library.area({ width: 2, height: 3 }) + library.area(),
    library.first([4]) + library.first(),
    library.called(() => 5) + library.called(),
    library.repeated("x", 3) + library.repeated(),
    library.nothing(null),
  ];
}
