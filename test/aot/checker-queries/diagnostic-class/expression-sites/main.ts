declare const anything: any;
declare const makeDecorator: any;
function makeFields() { return class { field = arguments; }; }
class NoBase { constructor() { super(); } }
function reads() { return super.member; }
function calls() { super(); }
export const name = anything.#name;
interface Shape { #name: number; }
@makeDecorator()() class Decorated {}
class Base { name = "base"; }
class ReadsObjectPrototype { describe() { return typeof super.toString; } }
class InArrow extends Base { constructor() { const initialize = () => super(); initialize(); } }
class InParameter extends Base { constructor(self = super()) { void self; } }
class InNestedParameter { make = function (first = arguments.length) { return first; }; }
function implicitThis() { return this; }
export const missing = globalThis.missing;
export { makeFields, NoBase, reads, calls, Decorated, ReadsObjectPrototype, InArrow, InParameter, InNestedParameter, implicitThis };
export type { Shape };
class StaticConstructor { static constructor() { void super.toString; } }
export { StaticConstructor };
