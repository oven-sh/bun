export interface Shape { size: number }
export const name: string = "the import";
export const onlyInTheText: string = "named by nothing but the text of an eval";
export let count: number = 0;
export function bump(): void { count++; }
export default function fallback(): string { return "the default"; }
