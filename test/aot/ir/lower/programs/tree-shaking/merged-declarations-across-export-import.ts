// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// The merged names of merged.ts are exported and used from here: the class side of one, the namespace side of another, both pieces of an enum, a function with its namespace, a default export that is a merged class.
import Default, { Shape, parse, Pieces, Level, Config } from "./merged";
import * as merged from "./merged";

const config: Config = Config;
console.log(new Shape().area(), Shape.unit, parse("x"), parse.version, Pieces.One + Pieces.Two, Level.describe(Level.High), config.port);
console.log(new Default().name(), Default.label, merged.Shape.unit, Object.keys(merged.Pieces).length);

// FILE: merged.ts
export class Shape { area() { return 4; } }
export namespace Shape { export const unit = "cm"; }
export function parse(text: string) { return "parsed " + text; }
export namespace parse { export const version = 2; }
export enum Pieces { One = 1 }
export enum Pieces { Two = 2 }
export enum Level { High = "high" }
export namespace Level { export const describe = (level: Level) => "level " + level; }
export interface Config { port: number }
export const Config = { port: 81 };
class Default { name() { return "the default"; } }
namespace Default { export const label = "its label"; }
export default Default;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
