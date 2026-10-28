import { Far } from "./far";
enum Near {
  One = 1,
}
namespace Inner {
  export enum Deep {
    Two = 2,
    Four = Deep.Two << 1,
  }
}
export enum Sum {
  First = Near.One,
  Second = Inner.Deep.Two | Inner.Deep.Four,
  Third = Far.Eight | Far.Sixteen,
  All = Sum.First | Sum.Second | Sum.Third,
}
