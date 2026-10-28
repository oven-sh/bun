// Enums of the program are made of constants that a declaration file declares with members of its enums for their values. One of those enums names its own members by a path.
import { least, most } from "./limits.js";
enum Size {
  Small = least,
  Large = most,
}
console.log(Size.Small, Size.Large, Size[Size.Small], Size[Size.Large]);
