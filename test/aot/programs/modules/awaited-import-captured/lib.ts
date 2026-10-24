export const NAME = "abc";
export const KIND: "x" | "y" = "x";
export const AS_CONST = "fixed" as const;
export const CHOSEN = Math.random() > 2 ? "left" : "right";
export let changing: "on" | "off" = "on";
export function flip(): void { changing = changing === "on" ? "off" : "on"; }
export enum Color { Red = "red", Blue = "blue" }
export const firstColor = Color.Red;
export const WIDE: string = "wide";
export function pick(): "p" | "q" { return "p"; }
