import { current, hoisted } from "./main.ts";
export function look(): string { let first: string; try { first = String(current.x); } catch (error) { first = (error as Error).constructor.name; } let second: string; try { second = String(hoisted.x); } catch (error) { second = (error as Error).constructor.name; } return first + " " + second + " " + (hoisted === undefined); }
export const early = look();
