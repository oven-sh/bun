import type * as parser from "./parser.js";
export type SimpleVisitors = { ArrowFunctionExpression?: (node: parser.ArrowFunctionExpression) => void; BlockStatement?: (node: parser.BlockStatement) => void; Program?: (node: parser.Program) => void };
export function simple(node: parser.Node, visitors: SimpleVisitors): void;
export function each(node: parser.Node, visit: (node: parser.Node) => void): void;
export function later<T extends parser.Node>(node: T): Promise<T>;
export class Walker { constructor(visitors: SimpleVisitors); run(node: parser.Node): void }
