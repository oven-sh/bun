import { Made } from "./made";
import * as base from "./base";

export enum Third {
  Eight = Made.Four * 2,
  Nine = Eight + base.Base.One,
  Name = Made.Name + "-third",
}
