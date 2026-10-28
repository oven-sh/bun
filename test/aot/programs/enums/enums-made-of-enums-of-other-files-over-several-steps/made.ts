import { Base } from "./base";

export enum Made {
  Three = Base.One + Base.Two,
  Four = Three + 1,
  Name = Base.Name + "-made",
  Length = Base.Name.length,
}
