// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1096 2
// DIAGNOSTIC: TS1025 1
// DIAGNOSTIC: TS1017 1
// DIAGNOSTIC: TS1018 1
// DIAGNOSTIC: TS1019 1
// DIAGNOSTIC: TS1020 1
// DIAGNOSTIC: TS1021 1
// DIAGNOSTIC: TS5086 1
// DIAGNOSTIC: TS5087 1
// DIAGNOSTIC: TS1172 1
// DIAGNOSTIC: TS1097 1
// DIAGNOSTIC: TS1099 3
// DIAGNOSTIC: TS1009 2
// DIAGNOSTIC: TS1183 1
// DIAGNOSTIC: TS8020 1
// DIAGNOSTIC: TS17019 1
// DIAGNOSTIC: TS17020 2
// DIAGNOSTIC: TS18016 1
// DIAGNOSTIC: TS1246 1
// DIAGNOSTIC: TS1247 1
// DIAGNOSTIC: TS2369 4
// DIAGNOSTIC: TS2371 6
// DIAGNOSTIC: TS1015 1
// DIAGNOSTIC: TS1048 4
// DIAGNOSTIC: TS1014 1
// DIAGNOSTIC: TS1206 1
// DIAGNOSTIC: TS2314 1

// What is written in a type leaves no trace in what runs, and TypeScript's parser reads over each of these mistakes. Plain Bun reads over a type with a grammar of its own and rejects a file
// that holds any one of them, so each stops the build. No check of the file finds them: the parser flags them, or a loop over the members, the signatures and the types of the file does.
interface Base {}
interface Other {}
interface Generic<T = number> {}

interface TwoKeys { [key: string, other: string]: number }
interface NoKey { []: number }
interface CommaBehindKey { [key: string,]: number }
interface RestKey { [...key: string[]]: number }
interface PublicKey { [public key: string]: number }
interface OptionalKey { [key?: string]: number }
interface KeyWithDefault { [key: string = ""]: number }
class NoTypeOfValues { [key: string]; }

type OptionalBehindType = [first: string?];
type DotsBeforeType = [first: ...string[]];

interface ExtendsTwice extends Base extends Other {}
interface ExtendsNothing extends {}
interface CommaBehindParent extends Base, {}
interface NoArgumentOfParent extends Generic<> {}
class NoArgumentOfInterface implements Generic<> {}
let noArgument: Array<>;
let commaBehindArgument: Array<number,>;

interface AccessorWithBody { get size() { return 1; } }

let star: *;
let questionBehind: number?;
let questionBefore: ?number;
let bangBefore: !number;

interface PrivateName { #name: number }
interface MemberWithValue { size: number = 1 }
type LiteralWithValue = { size: number = 1 };

function overloaded(public size: number): void;
function overloaded(...all: unknown[]) {}
interface PublicParameter { resize(public size: number): void }
type ReadonlyParameter = (readonly size: number) => void;
interface ParameterWithDefault { resize(size: number = 1): void }
type FunctionWithDefault = (size: number = 1) => void;
type OptionalWithDefault = (size?: number = 1) => void;
type RestWithDefault = (...sizes: number[] = []) => void;
declare function restWithDefault(...sizes: number[] = []): void;
declare function restNotLast(...sizes: number[], last: number): void;
declare function decorated(@mark size: number): void;

console.log("never printed");
export {};
