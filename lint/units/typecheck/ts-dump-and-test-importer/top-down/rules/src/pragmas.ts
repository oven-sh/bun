/// <reference path="./a.ts" />
/// <reference types="node" resolution-mode="import" />
/// <reference lib="es2015" />
// @ts-check
// @ts-ignore
let a: number = "x";
// @ts-expect-error
let b: number = "y";
/** @jsx h */
