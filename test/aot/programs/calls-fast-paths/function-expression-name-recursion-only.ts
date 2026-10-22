// Named function expressions whose own name is only used for recursive calls.
// IR= 0 recursion NewClosure
// IR= 0 recursion  = NewObject 
// IR= 0 walk NewClosure
// IR= 0 walk  = NewObject 
declare const console: any;
function recursion(n: number): number { return (function fact(m: number): number { return m < 2 ? 1 : m * fact(m - 1) % 1000003; })(n); }
interface Tree { left: Tree | null; right: Tree | null; value: number }
function walk(t: Tree): number { const sum = function visit(n: Tree | null): number { return n ? n.value + visit(n.left) + visit(n.right) : 0; }; return sum(t); }
function build(depth: number): Tree { return { left: depth ? build(depth - 1) : null, right: depth ? build(depth - 1) : null, value: depth }; }
const tree = build(10);
console.log(recursion(10), walk(tree));
let total = 0;
for (let i = 0; i < 2000; i++) total = (total + recursion(20 + (i & 7)) + walk(tree)) % 1000003;
console.log(total);
export {};
