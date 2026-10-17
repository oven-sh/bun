// Chains of tail calls that alternate between functions that return values of a declared type, functions that only pass on what another
// returns, functions that return `any`, and arrow functions that are only ever called as values. All run in constant space.
const lines: string[] = [];
function say(...parts: unknown[]) {
  lines.push(parts.map(part => (typeof part === "object" && part !== null ? JSON.stringify(part) : String(part))).join(" "));
}
const deep = 300000;
let sink: unknown;
type Step = (n: number, acc: number) => number;

function count(n: number, acc: number, next: Step): number {
  if (n === 0) return acc + 0.5;
  return next(n - 1, acc + 1);
}
const wrapped: Step[] = [(n, acc) => count(n, acc, wrapped[0]), (n, acc) => count(n, acc + 1, wrapped[1]), (n, acc) => (n === 0 ? acc : count(n - 1, acc, wrapped[2]))];
say(wrapped.map(step => count(deep, 0, step) + 1), wrapped.map(step => step(deep + 1, 0)));

const handlers: ((n: number, acc: number) => any)[] = [];
function passOn(n: number, acc: number): any {
  return handlers[n & 1](n, acc);
}
function typedAbove(n: number, acc: number): number {
  if (n === 0) return acc + 0.25;
  return passOn(n - 1, acc + 1);
}
function typedAboveWithCast(n: number, acc: number): number {
  if (n === 0) return acc - 0.25;
  return passOn(n - 1, acc + 2) as number;
}
handlers.push(typedAbove, typedAboveWithCast);
sink = [passOn, typedAbove, typedAboveWithCast];
say(typedAbove(deep, 0) * 2, typedAboveWithCast(deep, 0) * 2, passOn(deep, 0), typedAbove(deep + 1, 0), handlers.map(handler => handler(deep, 0)));

interface Node {
  depth: number;
  label: string;
}
function descend(node: Node, visit: (node: Node) => Node): Node {
  if (node.depth === 0) return { depth: -1, label: node.label + "." };
  return forward({ depth: node.depth - 1, label: node.label }, visit);
}
function forward(node: Node, visit: (node: Node) => Node): Node {
  return visit(node);
}
const visitors: ((node: Node) => Node)[] = [node => descend(node, visitors[0]), node => forward(node, visitors[2]), node => (node.depth === 0 ? node : descend(node, visitors[1]))];
sink = [descend, forward];
say(visitors.map(visit => descend({ depth: deep, label: "n" }, visit).label), visitors.map(visit => visit({ depth: deep + 1, label: "m" }).depth), forward({ depth: 3, label: "f" }, visitors[0]));

function flag(n: number, odd: boolean, next: (n: number, odd: boolean) => boolean): boolean {
  if (n === 0) return odd;
  return flip(n, odd, next);
}
function flip(n: number, odd: boolean, next: (n: number, odd: boolean) => boolean): boolean {
  if (n < 0) return false;
  return next(n - 1, !odd);
}
const flagged = (n: number, odd: boolean): boolean => flag(n, odd, flagged);
const flipped = (n: number, odd: boolean): boolean => flip(n, odd, flipped);
sink = [flag, flip, [flagged, flipped]];
say(flag(deep, false, flagged), flag(deep + 1, false, flagged), flip(deep, false, flipped), [flagged, flipped].map(f => f(deep + 1, true)), !flag(5, false, flipped));

let total = 0;
for (let i = 0; i < 20000; i++) total += count(i & 3, i, wrapped[i % 3]) + typedAbove(i & 3, i) + typedAboveWithCast(i & 1, i) + descend({ depth: i & 1, label: "x" }, visitors[0]).depth + (flag(i & 3, false, flagged) ? 1 : 0);
say(total);
console.log(lines.join("\n"));
