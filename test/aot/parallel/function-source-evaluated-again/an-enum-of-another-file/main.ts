// Reference: bun build --compile
// The enum is declared in another file of the program: a bundle has the values in place of the reads, `bun <file>` reads the enum.
import { Color, Fixed, Tone, Shapes } from "./colors";
import * as all from "./colors";
function named() { return [Color.Green, Fixed.Two, Tone.Low]; }
function through() { return [all.Color.Red, all.Tone.Low]; }
function deeper() { return Shapes.Kind.Round; }
const attempt = (label: string, made: () => unknown) => { try { console.log(label, JSON.stringify(made())); } catch (error) { console.log(label, (error as Error).name); } };
const again = (made: Function): any => (0, eval)("(" + String(made) + ")");
attempt("own", () => [named(), through(), deeper()]);
attempt("named", () => again(named)());
attempt("through", () => again(through)());
attempt("deeper", () => again(deeper)());
