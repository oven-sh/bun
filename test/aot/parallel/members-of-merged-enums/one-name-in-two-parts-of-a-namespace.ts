namespace Shelf { export enum Level { Low = 1 } export const early = Level.Low; }
namespace Shelf { export enum Level { Low = 5 } export const late = Level.Low; }
console.log(Shelf.early, Shelf.late, Shelf.Level.Low);
