import { Api } from "./exporter.ts";
export function call(word: string): void { try { console.log(word, Api.read()); } catch (error) { console.log(word, (error as Error).name); } }
