export interface Node { type: string; start: number; end: number }
export interface BlockStatement extends Node { type: "BlockStatement" }
export interface ArrowFunctionExpression extends Node { type: "ArrowFunctionExpression"; async: boolean; expression: boolean; body: BlockStatement }
export interface Program extends Node { type: "Program"; body: Node[] }
export function parse(text: string): Program;
