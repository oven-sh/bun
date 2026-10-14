// `delete` of a property that is optional in the type through which it is deleted.
interface Base { kind: number; }
interface WithFlags extends Base { flags?: number; }
interface Everything extends Base { flags: number; }
function full(kind: number, flags: number): WithFlags { return { kind, flags }; }
function everything(kind: number, flags: number): Everything { return { kind, flags }; }
function maybeFlags(base: Base): number | undefined { return (base as Everything).flags; }
const deleted = full(3, 4);
delete deleted.flags;
console.log(deleted.flags, Object.keys(deleted).join()); // undefined kind
console.log(maybeFlags(everything(1, 2)), maybeFlags(full(5, 6)), maybeFlags(deleted)); // 2 6 undefined
