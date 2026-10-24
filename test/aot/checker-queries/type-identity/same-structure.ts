// An object type is identified by who declared it. An interface, an alias and a type literal with the same members have three identities, in one file or in two. One declaration has one identity wherever it is named.
import "./same-structure-other";
interface A { x: number }
type B = { x: number };
let v1: A;
let v2: B;
let v3: A;
let v4: { x: number };
let v5: A;
