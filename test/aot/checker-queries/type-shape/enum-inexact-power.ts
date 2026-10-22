// The type of an enum member that the program computes holds no value: the checker's digits are not the engine's.
import { Other } from "./enum-inexact-power-other";
enum Size { Exact = 2 ** 10, Inexact = 3 ** 100, After, Text = `${3 ** 100}`, ExactText = `${2 ** 10}`, Borrowed = Other.Inexact }
let v1: Size.Exact;
let v2: Size.Inexact;
let v3: Size.After;
let v4: Size.Text;
let v5: Size.ExactText;
let v6: Size.Borrowed;
let v7: Other.Inexact;
export {};
